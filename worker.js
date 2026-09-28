const OWNER_ID = "7559560220";

// ============================================================
// Private RSS Reader
// Cloudflare Workers + D1 + Telegram Bot
//
// 单用户私人 RSS Reader
//
// Secrets:
//   BOT_TOKEN
//
// Optional Secret:
//   TELEGRAPH_ACCESS_TOKEN
//
// D1:
//   DB
//
// Cron:
//   */5 * * * *
// ============================================================

const CONFIG = {
  DEFAULT_RSSHUB: "https://rsshub.app",

  DEFAULT_INTERVAL: 10,

  PAGE_SIZE: 8,

  MAX_FEEDS_PER_RUN: 20,

  MAX_ENTRIES_PER_FEED: 30,

  MAX_MEDIA_PER_GROUP: 10,

  MAX_FILTERS: 30,

  RSS_TIMEOUT: 15000,

  ARTICLE_TIMEOUT: 20000,

  MAX_ARTICLE_LENGTH: 120000,

  MAX_TELEGRAM_TEXT: 3900,

  MAX_CAPTION: 950,

  MAX_OPML_SIZE: 2 * 1024 * 1024,

  USER_AGENT:
    "PrivateRSSReader/1.0 (+Cloudflare Workers)",

  TELEGRAPH_API:
    "https://api.telegra.ph",
};


// ============================================================
// Worker
// ============================================================

export default {

  async fetch(request, env, ctx) {

    try {

      if (request.method === "GET") {

        const url = new URL(request.url);

        if (url.pathname === "/") {
          return new Response(
            "Private RSS Reader is running.",
            { status: 200 }
          );
        }

        if (url.pathname === "/health") {
          return json({
            ok: true,
            service: "private-rss-reader",
            owner: OWNER_ID,
          });
        }

        return new Response("Not Found", {
          status: 404,
        });
      }


      if (request.method !== "POST") {
        return new Response(
          "Method Not Allowed",
          { status: 405 }
        );
      }


      const update = await request.json();

      /*
       * Telegram Webhook 必须快速返回。
       * 实际处理交给 waitUntil。
       */
      ctx.waitUntil(
        handleUpdate(update, env)
          .catch(err => {
            console.error("UPDATE ERROR", err);
          })
      );

      return new Response("OK");

    } catch (error) {

      console.error("FETCH ERROR", error);

      return new Response("OK");
    }
  },


  async scheduled(event, env, ctx) {

    ctx.waitUntil(
      runScheduler(env)
        .catch(err => {
          console.error("SCHEDULER ERROR", err);
        })
    );
  },

};


// ============================================================
// Authorization
// ============================================================

function getTelegramUserId(update) {

  return String(
    update?.message?.from?.id ??
    update?.callback_query?.from?.id ??
    update?.my_chat_member?.from?.id ??
    ""
  );
}


function isOwner(update) {

  return getTelegramUserId(update) === OWNER_ID;
}


// ============================================================
// Update Router
// ============================================================

async function handleUpdate(update, env) {

  /*
   * 第一层硬限制。
   *
   * 不是 OWNER_ID：
   * 不回复
   * 不处理
   * 不写数据库
   */
  if (!isOwner(update)) {
    return;
  }


  if (update.callback_query) {

    return handleCallback(
      update.callback_query,
      env
    );
  }


  if (update.message) {

    return handleMessage(
      update.message,
      env
    );
  }
}


// ============================================================
// Message Handler
// ============================================================

async function handleMessage(message, env) {

  if (String(message.from?.id) !== OWNER_ID) {
    return;
  }


  const chatId =
    String(message.chat?.id || OWNER_ID);


  // ----------------------------------------------------------
  // OPML
  // ----------------------------------------------------------

  if (message.document) {

    const filename =
      String(
        message.document.file_name || ""
      ).toLowerCase();


    if (
      filename.endsWith(".opml") ||
      filename.endsWith(".xml")
    ) {

      return importOPML(
        chatId,
        message.document,
        env
      );
    }
  }


  const text =
    String(
      message.text ||
      message.caption ||
      ""
    ).trim();


  if (!text) {
    return;
  }


  // ----------------------------------------------------------
  // Temporary states
  // ----------------------------------------------------------

  const state =
    await getState(
      env,
      OWNER_ID
    );


  if (
    state?.type === "rsshub" &&
    !text.startsWith("/")
  ) {

    const value =
      normalizeBaseUrl(text);


    if (!value) {

      return sendText(
        chatId,
        "❌ RSSHub Instance 地址无效。\n\n请输入 http(s) 地址。",
        env
      );
    }


    await saveRSSHub(
      env,
      OWNER_ID,
      value
    );


    await clearState(
      env,
      OWNER_ID
    );


    return showSettings(
      chatId,
      env
    );
  }


  if (
    state?.type === "filter" &&
    !text.startsWith("/")
  ) {

    const keyword =
      text.trim();


    if (!keyword) {
      return;
    }


    await env.DB.prepare(`
      INSERT INTO filters
      (
        feed_id,
        mode,
        keyword,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
      .bind(
        state.feedId,
        state.mode,
        keyword,
        now()
      )
      .run();


    await clearState(
      env,
      OWNER_ID
    );


    return showFilters(
      chatId,
      state.feedId,
      env
    );
  }


  // ----------------------------------------------------------
  // Commands
  // ----------------------------------------------------------

  if (
    text === "/start" ||
    text === "/menu"
  ) {

    await clearState(
      env,
      OWNER_ID
    );

    return showMainMenu(
      chatId,
      env
    );
  }


  if (text === "/help") {

    return sendHelp(
      chatId,
      env
    );
  }


  if (text === "/feeds") {

    return showFeeds(
      chatId,
      0,
      env
    );
  }


  if (text === "/settings") {

    return showSettings(
      chatId,
      env
    );
  }


  if (text.startsWith("/add ")) {

    const url =
      text.slice(5).trim();

    return addFeed(
      chatId,
      url,
      env
    );
  }


  if (text.startsWith("/")) {

    return sendText(
      chatId,
      "❓ 未知命令。\n\n发送 /help 查看使用方法。",
      env
    );
  }


  // ----------------------------------------------------------
  // Direct URL
  // ----------------------------------------------------------

  if (isHttpUrl(text)) {

    return addFeed(
      chatId,
      text,
      env
    );
  }
}


// ============================================================
// Callback Router
// ============================================================

async function handleCallback(query, env) {

  if (
    String(query.from?.id) !== OWNER_ID
  ) {
    return;
  }


  const chatId =
    String(
      query.message?.chat?.id ||
      OWNER_ID
    );


  const messageId =
    query.message?.message_id;


  await tg(
    "answerCallbackQuery",
    {
      callback_query_id:
        query.id,
    },
    env
  ).catch(() => {});


  const data =
    String(query.data || "");


  const [
    action,
    ...parts
  ] = data.split(":");


  switch (action) {

    case "menu":
      await clearState(env, OWNER_ID);
      return showMainMenu(
        chatId,
        env,
        messageId
      );


    case "add":
      return showAddPrompt(
        chatId,
        env,
        messageId
      );


    case "feeds":
      return showFeeds(
        chatId,
        Number(parts[0] || 0),
        env,
        messageId
      );


    case "feed":
      return showFeed(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "feedtoggle":
      return toggleFeed(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "feeddelete":
      return confirmDeleteFeed(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "feeddeleteyes":
      return deleteFeed(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "type":
      return showFeedTypes(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "settype":
      return setFeedType(
        chatId,
        parts[0],
        parts[1],
        env,
        messageId
      );


    case "filter":
      return showFilters(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "filteradd":
      return startFilterInput(
        chatId,
        parts[0],
        parts[1],
        env,
        messageId
      );


    case "filterdel":
      return deleteFilter(
        chatId,
        parts[0],
        parts[1],
        env,
        messageId
      );


    case "rss":
      return showRSSSettings(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "interval":
      return showIntervals(
        chatId,
        parts[0],
        env,
        messageId
      );


    case "setinterval":
      return setIntervalForFeed(
        chatId,
        parts[0],
        Number(parts[1]),
        env,
        messageId
      );


    case "settings":
      return showSettings(
        chatId,
        env,
        messageId
      );


    case "rsshub":
      return showRSSHubSetting(
        chatId,
        env,
        messageId
      );


    case "rsshubdefault":
      return setRSSHub(
        chatId,
        CONFIG.DEFAULT_RSSHUB,
        env,
        messageId
      );


    case "opml":
      return showOPMLMenu(
        chatId,
        env,
        messageId
      );


    case "exportopml":
      return exportOPML(
        chatId,
        env
      );


    default:
      return showMainMenu(
        chatId,
        env,
        messageId
      );
  }
}


// ============================================================
// Main Menu
// ============================================================

async function showMainMenu(
  chatId,
  env,
  messageId
) {

  const count =
    await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM subscriptions
      WHERE user_id=?
    `)
      .bind(OWNER_ID)
      .first();


  const feedCount =
    Number(count?.n || 0);


  const text =
`<b>📰 RSS Reader</b>

私人 RSS 阅读器

📡 当前订阅：<b>${feedCount}</b>

将 RSS / RSSHub / Atom 订阅统一发送到 Telegram。

直接发送 RSS 地址即可添加。`;


  const keyboard = {
    inline_keyboard: [

      [
        {
          text: "📡 我的订阅",
          callback_data: "feeds:0"
        }
      ],

      [
        {
          text: "➕ 添加订阅",
          callback_data: "add"
        },
        {
          text: "⚙️ 设置",
          callback_data: "settings"
        }
      ],

      [
        {
          text: "📥📤 OPML",
          callback_data: "opml"
        },
        {
          text: "❔ 帮助",
          callback_data: "help"
        }
      ]

    ]
  };


  return editOrSend(
    chatId,
    messageId,
    text,
    keyboard,
    env
  );
}


// ============================================================
// Add Prompt
// ============================================================

async function showAddPrompt(
  chatId,
  env,
  messageId
) {

  await clearState(
    env,
    OWNER_ID
  );


  const text =
`<b>➕ 添加订阅</b>

发送 RSS / Atom 地址。

例如：

<code>/add https://example.com/rss.xml</code>

也可以直接发送：

<code>https://example.com/rss.xml</code>

添加后不会发送历史文章，只会从下一次更新开始推送。`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [
        [
          {
            text: "⬅️ 返回",
            callback_data: "menu"
          }
        ]
      ]
    },
    env
  );
}


// ============================================================
// Help
// ============================================================

async function sendHelp(
  chatId,
  env,
  messageId
) {

  const text =
`<b>❔ 使用说明</b>

<b>添加 RSS</b>
<code>/add https://example.com/rss.xml</code>

也可以直接发送 RSS URL。

<b>订阅管理</b>
/feeds

<b>设置</b>
/settings

<b>推送逻辑</b>
• 新订阅不会推送历史内容
• 自动去重
• 支持关键词过滤
• 支持 RSSHub
• 支持 OPML
• 图片 / 视频自动媒体化
• 文章自动生成 Telegraph 页面

<b>支持的媒体</b>
🖼 图片
🎬 视频
🎞 GIF
📰 文章
📝 普通 RSS`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [
        [
          {
            text: "⬅️ 返回",
            callback_data: "menu"
          }
        ]
      ]
    },
    env
  );
}


// ============================================================
// Feed List
// ============================================================

async function showFeeds(
  chatId,
  page,
  env,
  messageId
) {

  const offset =
    page * CONFIG.PAGE_SIZE;


  const rows =
    await env.DB.prepare(`
      SELECT
        f.id,
        f.title,
        f.site_url,
        f.feed_type,
        s.enabled,
        s.interval_minutes
      FROM subscriptions s
      JOIN feeds f
        ON f.id=s.feed_id
      WHERE s.user_id=?
      ORDER BY f.title COLLATE NOCASE
      LIMIT ? OFFSET ?
    `)
      .bind(
        OWNER_ID,
        CONFIG.PAGE_SIZE,
        offset
      )
      .all();


  const items =
    rows.results || [];


  const totalRow =
    await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM subscriptions
      WHERE user_id=?
    `)
      .bind(OWNER_ID)
      .first();


  const total =
    Number(totalRow?.n || 0);


  let text =
`<b>📡 我的订阅</b>

`;


  if (!items.length) {

    text +=
`还没有订阅。

点击「➕ 添加订阅」开始。`;

  } else {

    items.forEach(
      (item, index) => {

        const number =
          offset + index + 1;

        const status =
          item.enabled
            ? "🟢"
            : "⏸️";


        const title =
          escapeHtml(
            item.title ||
            item.site_url ||
            "未命名"
          );


        text +=
`${status} <b>${number}</b>  ${title}\n`;
      }
    );

  }


  const keyboard = [];


  for (
    let i = 0;
    i < items.length;
    i += 2
  ) {

    const row = [];


    for (
      let j = i;
      j < Math.min(i + 2, items.length);
      j++
    ) {

      row.push({
        text: String(offset + j + 1),
        callback_data:
          `feed:${items[j].id}`
      });
    }


    keyboard.push(row);
  }


  const navigation = [];


  if (page > 0) {

    navigation.push({
      text: "‹ 上一页",
      callback_data:
        `feeds:${page - 1}`
    });
  }


  if (
    offset + items.length < total
  ) {

    navigation.push({
      text: "下一页 ›",
      callback_data:
        `feeds:${page + 1}`
    });
  }


  if (navigation.length) {
    keyboard.push(navigation);
  }


  keyboard.push([
    {
      text: "➕ 添加",
      callback_data: "add"
    },
    {
      text: "🏠 主菜单",
      callback_data: "menu"
    }
  ]);


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard:
        keyboard
    },
    env
  );
}


// ============================================================
// Feed Detail
// ============================================================

async function showFeed(
  chatId,
  feedId,
  env,
  messageId
) {

  const feed =
    await getFeed(
      feedId,
      env
    );


  if (!feed) {

    return editOrSend(
      chatId,
      messageId,
      "❌ 找不到这个订阅。",
      {
        inline_keyboard: [
          [
            {
              text: "⬅️ 我的订阅",
              callback_data: "feeds:0"
            }
          ]
        ]
      },
      env
    );
  }


  const sub =
    await env.DB.prepare(`
      SELECT *
      FROM subscriptions
      WHERE user_id=?
      AND feed_id=?
    `)
      .bind(
        OWNER_ID,
        feedId
      )
      .first();


  const filterCount =
    await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM filters
      WHERE feed_id=?
    `)
      .bind(feedId)
      .first();


  const typeNames = {

    auto: "🤖 自动",

    media: "🖼 媒体",

    article: "📰 文章",

    text: "📝 纯文本",

  };


  const type =
    typeNames[feed.feed_type] ||
    typeNames.auto;


  const status =
    sub?.enabled
      ? "🟢 推送中"
      : "⏸️ 已暂停";


  const text =
`<b>📡 ${escapeHtml(
  feed.title || "未命名订阅"
)}</b>

${status}

🎨 显示方式：${type}

⏱ 检查周期：
<b>${sub?.interval_minutes || CONFIG.DEFAULT_INTERVAL} 分钟</b>

🔍 过滤规则：
<b>${Number(filterCount?.n || 0)}</b>

🔗 ${escapeHtml(
  feed.site_url || feed.url
)}`;


  const keyboard = {
    inline_keyboard: [

      [
        {
          text: sub?.enabled
            ? "⏸ 暂停推送"
            : "▶️ 恢复推送",

          callback_data:
            `feedtoggle:${feedId}`
        }
      ],

      [
        {
          text: "🎨 显示方式",
          callback_data:
            `type:${feedId}`
        },

        {
          text: "🔍 关键词",
          callback_data:
            `filter:${feedId}`
        }
      ],

      [
        {
          text: "⚙️ RSS 设置",
          callback_data:
            `rss:${feedId}`
        }
      ],

      [
        {
          text: "🗑 删除订阅",
          callback_data:
            `feeddelete:${feedId}`
        }
      ],

      [
        {
          text: "⬅️ 我的订阅",
          callback_data:
            "feeds:0"
        }
      ]

    ]
  };


  return editOrSend(
    chatId,
    messageId,
    text,
    keyboard,
    env
  );
}


// ============================================================
// Feed Type
// ============================================================

async function showFeedTypes(
  chatId,
  feedId,
  env,
  messageId
) {

  const text =
`<b>🎨 显示方式</b>

选择这个 RSS 的消息渲染方式。

<b>🤖 自动</b>
根据 RSS 内容自动判断。

<b>🖼 媒体</b>
图片 / 视频优先。

<b>📰 文章</b>
生成 Telegraph 阅读页面。

<b>📝 纯文本</b>
只发送 Telegram 文字。`;


  const keyboard = {
    inline_keyboard: [

      [
        {
          text: "🤖 自动",
          callback_data:
            `settype:${feedId}:auto`
        }
      ],

      [
        {
          text: "🖼 媒体",
          callback_data:
            `settype:${feedId}:media`
        }
      ],

      [
        {
          text: "📰 文章",
          callback_data:
            `settype:${feedId}:article`
        }
      ],

      [
        {
          text: "📝 纯文本",
          callback_data:
            `settype:${feedId}:text`
        }
      ],

      [
        {
          text: "⬅️ 返回",
          callback_data:
            `feed:${feedId}`
        }
      ]

    ]
  };


  return editOrSend(
    chatId,
    messageId,
    text,
    keyboard,
    env
  );
}


async function setFeedType(
  chatId,
  feedId,
  type,
  env,
  messageId
) {

  if (
    ![
      "auto",
      "media",
      "article",
      "text"
    ].includes(type)
  ) {
    return;
  }


  await env.DB.prepare(`
    UPDATE feeds
    SET feed_type=?,
        updated_at=?
    WHERE id=?
  `)
    .bind(
      type,
      now(),
      feedId
    )
    .run();


  return showFeed(
    chatId,
    feedId,
    env,
    messageId
  );
}


// ============================================================
// Feed RSS Settings
// ============================================================

async function showRSSSettings(
  chatId,
  feedId,
  env,
  messageId
) {

  const feed =
    await getFeed(
      feedId,
      env
    );


  if (!feed) {
    return;
  }


  const sub =
    await env.DB.prepare(`
      SELECT *
      FROM subscriptions
      WHERE user_id=?
      AND feed_id=?
    `)
      .bind(
        OWNER_ID,
        feedId
      )
      .first();


  const text =
`<b>⚙️ RSS 设置</b>

<b>${escapeHtml(
  feed.title
)}</b>

当前检查周期：

⏱ <b>${
  sub?.interval_minutes ||
  CONFIG.DEFAULT_INTERVAL
} 分钟</b>

Worker 会按照这个周期检查 RSS。`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [

        [
          {
            text: "⏱ 检查周期",
            callback_data:
              `interval:${feedId}`
          }
        ],

        [
          {
            text: "⬅️ 返回",
            callback_data:
              `feed:${feedId}`
          }
        ]

      ]
    },
    env
  );
}


async function showIntervals(
  chatId,
  feedId,
  env,
  messageId
) {

  const values = [
    5,
    10,
    30,
    60,
    180
  ];


  const keyboard =
    values.map(
      minutes => [

        {
          text:
            minutes < 60
              ? `${minutes} 分钟`
              : `${minutes / 60} 小时`,

          callback_data:
            `setinterval:${feedId}:${minutes}`
        }

      ]
    );


  keyboard.push([
    {
      text: "⬅️ 返回",
      callback_data:
        `rss:${feedId}`
    }
  ]);


  return editOrSend(
    chatId,
    messageId,
    "<b>⏱ 检查周期</b>\n\n选择 RSS 检查频率。",
    {
      inline_keyboard:
        keyboard
    },
    env
  );
}


async function setIntervalForFeed(
  chatId,
  feedId,
  minutes,
  env,
  messageId
) {

  if (
    ![
      5,
      10,
      30,
      60,
      180
    ].includes(minutes)
  ) {
    return;
  }


  const next =
    new Date(
      Date.now() + minutes * 60000
    ).toISOString();


  await env.DB.prepare(`
    UPDATE subscriptions
    SET interval_minutes=?,
        next_check_at=?,
        updated_at=?
    WHERE user_id=?
    AND feed_id=?
  `)
    .bind(
      minutes,
      next,
      now(),
      OWNER_ID,
      feedId
    )
    .run();


  return showFeed(
    chatId,
    feedId,
    env,
    messageId
  );
}


// ============================================================
// Toggle
// ============================================================

async function toggleFeed(
  chatId,
  feedId,
  env,
  messageId
) {

  await env.DB.prepare(`
    UPDATE subscriptions
    SET enabled=
      CASE
        WHEN enabled=1 THEN 0
        ELSE 1
      END,
      next_check_at=?,
      updated_at=?
    WHERE user_id=?
    AND feed_id=?
  `)
    .bind(
      now(),
      now(),
      OWNER_ID,
      feedId
    )
    .run();


  return showFeed(
    chatId,
    feedId,
    env,
    messageId
  );
}


// ============================================================
// Delete Feed
// ============================================================

async function confirmDeleteFeed(
  chatId,
  feedId,
  env,
  messageId
) {

  const feed =
    await getFeed(
      feedId,
      env
    );


  if (!feed) {
    return;
  }


  const text =
`<b>🗑 删除订阅</b>

确定删除：

<b>${escapeHtml(
  feed.title
)}</b>

删除后会同时清除：

• 订阅关系
• 历史 Entry
• 关键词规则

这个操作无法恢复。`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [

        [
          {
            text: "🗑 确认删除",
            callback_data:
              `feeddeleteyes:${feedId}`
          }
        ],

        [
          {
            text: "取消",
            callback_data:
              `feed:${feedId}`
          }
        ]

      ]
    },
    env
  );
}


async function deleteFeed(
  chatId,
  feedId,
  env,
  messageId
) {

  await env.DB.prepare(`
    DELETE FROM subscriptions
    WHERE user_id=?
    AND feed_id=?
  `)
    .bind(
      OWNER_ID,
      feedId
    )
    .run();


  const count =
    await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM subscriptions
      WHERE feed_id=?
    `)
      .bind(feedId)
      .first();


  if (
    Number(count?.n || 0) === 0
  ) {

    await env.DB.prepare(`
      DELETE FROM filters
      WHERE feed_id=?
    `)
      .bind(feedId)
      .run();


    await env.DB.prepare(`
      DELETE FROM feed_entries
      WHERE feed_id=?
    `)
      .bind(feedId)
      .run();


    await env.DB.prepare(`
      DELETE FROM feeds
      WHERE id=?
    `)
      .bind(feedId)
      .run();
  }


  return showFeeds(
    chatId,
    0,
    env,
    messageId
  );
}


// ============================================================
// Filters
// ============================================================

async function showFilters(
  chatId,
  feedId,
  env,
  messageId
) {

  const rows =
    await env.DB.prepare(`
      SELECT id, mode, keyword
      FROM filters
      WHERE feed_id=?
      ORDER BY id
    `)
      .bind(feedId)
      .all();


  const filters =
    rows.results || [];


  let text =
`<b>🔍 关键词过滤</b>

`;


  if (!filters.length) {

    text +=
      "目前没有过滤规则。\n\n";

  } else {

    filters.forEach(
      filter => {

        const icon =
          filter.mode === "include"
            ? "🟢"
            : "🔴";


        const mode =
          filter.mode === "include"
            ? "包含"
            : "排除";


        text +=
`${icon} <b>${mode}</b>  ${escapeHtml(
  filter.keyword
)}\n`;
      }
    );

    text += "\n";
  }


  text +=
`<b>匹配范围</b>

标题
摘要
正文

包含规则存在时：
至少命中一个包含关键词。

排除规则命中时：
直接跳过该条目。`;


  const keyboard = [];


  keyboard.push([
    {
      text: "🟢 添加包含关键词",
      callback_data:
        `filteradd:${feedId}:include`
    }
  ]);


  keyboard.push([
    {
      text: "🔴 添加排除关键词",
      callback_data:
        `filteradd:${feedId}:exclude`
    }
  ]);


  for (const filter of filters) {

    keyboard.push([
      {
        text:
          `🗑 ${filter.keyword}`.slice(
            0,
            50
          ),

        callback_data:
          `filterdel:${feedId}:${filter.id}`
      }
    ]);
  }


  keyboard.push([
    {
      text: "⬅️ 返回",
      callback_data:
        `feed:${feedId}`
    }
  ]);


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard:
        keyboard
    },
    env
  );
}


async function startFilterInput(
  chatId,
  feedId,
  mode,
  env,
  messageId
) {

  const count =
    await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM filters
      WHERE feed_id=?
    `)
      .bind(feedId)
      .first();


  if (
    Number(count?.n || 0)
    >= CONFIG.MAX_FILTERS
  ) {

    return editOrSend(
      chatId,
      messageId,
      "❌ 这个订阅已经达到关键词规则上限。",
      {
        inline_keyboard: [
          [
            {
              text: "⬅️ 返回",
              callback_data:
                `filter:${feedId}`
            }
          ]
        ]
      },
      env
    );
  }


  await setState(
    env,
    OWNER_ID,
    {
      type: "filter",
      feedId,
      mode
    }
  );


  const name =
    mode === "include"
      ? "🟢 包含关键词"
      : "🔴 排除关键词";


  return editOrSend(
    chatId,
    messageId,
    `<b>${name}</b>

请直接发送关键词。

例如：

<code>OpenAI</code>

发送后立即保存。

取消：
/menu`,
    {
      inline_keyboard: [
        [
          {
            text: "取消",
            callback_data:
              `filter:${feedId}`
          }
        ]
      ]
    },
    env
  );
}


async function deleteFilter(
  chatId,
  feedId,
  id,
  env,
  messageId
) {

  await env.DB.prepare(`
    DELETE FROM filters
    WHERE id=?
    AND feed_id=?
  `)
    .bind(
      id,
      feedId
    )
    .run();


  return showFilters(
    chatId,
    feedId,
    env,
    messageId
  );
}


// ============================================================
// Global Settings
// ============================================================

async function showSettings(
  chatId,
  env,
  messageId
) {

  const settings =
    await getSettings(
      env,
      OWNER_ID
    );


  const text =
`<b>⚙️ 设置</b>

<b>RSSHub Instance</b>

<code>${escapeHtml(
  settings.rsshub_instance
)}</code>

RSSHub 地址会应用于这个账号的所有 RSSHub 路由。

此外还可以：

• 导入 / 导出 OPML
• 管理 RSSHub Instance`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [

        [
          {
            text: "🔧 RSSHub Instance",
            callback_data:
              "rsshub"
          }
        ],

        [
          {
            text: "📥📤 OPML",
            callback_data:
              "opml"
          }
        ],

        [
          {
            text: "🏠 主菜单",
            callback_data:
              "menu"
          }
        ]

      ]
    },
    env
  );
}


// ============================================================
// RSSHub
// ============================================================

async function showRSSHubSetting(
  chatId,
  env,
  messageId
) {

  const settings =
    await getSettings(
      env,
      OWNER_ID
    );


  await setState(
    env,
    OWNER_ID,
    {
      type: "rsshub"
    }
  );


  const text =
`<b>🔧 RSSHub Instance</b>

当前实例：

<code>${escapeHtml(
  settings.rsshub_instance
)}</code>

直接发送新的实例地址。

例如：

<code>https://rsshub.example.com</code>

保存后以后 RSSHub 路由会自动使用新的实例。`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [

        [
          {
            text: "♻️ 恢复默认",
            callback_data:
              "rsshubdefault"
          }
        ],

        [
          {
            text: "⬅️ 返回",
            callback_data:
              "settings"
          }
        ]

      ]
    },
    env
  );
}


async function setRSSHub(
  chatId,
  value,
  env,
  messageId
) {

  const normalized =
    normalizeBaseUrl(value);


  if (!normalized) {

    return sendText(
      chatId,
      "❌ RSSHub Instance 无效。",
      env
    );
  }


  await saveRSSHub(
    env,
    OWNER_ID,
    normalized
  );


  await clearState(
    env,
    OWNER_ID
  );


  return showSettings(
    chatId,
    env,
    messageId
  );
}


async function saveRSSHub(
  env,
  userId,
  value
) {

  await env.DB.prepare(`
    INSERT INTO user_settings
    (
      user_id,
      rsshub_instance,
      language
    )
    VALUES (?, ?, ?)

    ON CONFLICT(user_id)
    DO UPDATE SET
      rsshub_instance=
        excluded.rsshub_instance
  `)
    .bind(
      userId,
      value,
      "zh-CN"
    )
    .run();
}


// ============================================================
// OPML
// ============================================================

async function showOPMLMenu(
  chatId,
  env,
  messageId
) {

  const text =
`<b>📥📤 OPML</b>

用于批量迁移 RSS 订阅。

<b>📥 导入</b>
直接把 .opml 文件发送给 Bot。

<b>📤 导出</b>
把当前所有订阅导出成 OPML。

导入时不会发送 RSS 历史内容。`;


  return editOrSend(
    chatId,
    messageId,
    text,
    {
      inline_keyboard: [

        [
          {
            text: "📤 导出 OPML",
            callback_data:
              "exportopml"
          }
        ],

        [
          {
            text: "⬅️ 返回",
            callback_data:
              "settings"
          }
        ]

      ]
    },
    env
  );
}


async function importOPML(
  chatId,
  document,
  env
) {

  const status =
    await sendText(
      chatId,
      "⏳ 正在读取 OPML…",
      env
    );


  try {

    const file =
      await tg(
        "getFile",
        {
          file_id:
            document.file_id
        },
        env
      );


    const path =
      file.result?.file_path;


    if (!path) {
      throw new Error(
        "无法获取 Telegram 文件"
      );
    }


    const response =
      await fetch(
        `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`
      );


    const buffer =
      await response.arrayBuffer();


    if (
      buffer.byteLength >
      CONFIG.MAX_OPML_SIZE
    ) {

      throw new Error(
        "OPML 文件过大"
      );
    }


    const xml =
      new TextDecoder()
        .decode(buffer);


    const urls =
      parseOPML(xml);


    if (!urls.length) {

      throw new Error(
        "没有发现有效 RSS URL"
      );
    }


    let success = 0;
    let failed = 0;


    /*
     * OPML 导入时不推送历史。
     */
    for (
      const url of urls
    ) {

      try {

        await addFeedInternal(
          url,
          env
        );

        success++;

      } catch (error) {

        failed++;

        console.error(
          "OPML FEED ERROR",
          url,
          error
        );
      }
    }


    const result =
`<b>✅ OPML 导入完成</b>

📡 RSS：<b>${urls.length}</b>

🟢 成功：<b>${success}</b>
🔴 失败：<b>${failed}</b>

历史内容不会被推送。`;


    return editMessage(
      chatId,
      status?.result?.message_id,
      result,
      {
        inline_keyboard: [
          [
            {
              text: "📡 我的订阅",
              callback_data:
                "feeds:0"
            }
          ]
        ]
      },
      env
    );

  } catch (error) {

    console.error(
      "OPML IMPORT",
      error
    );


    return editMessage(
      chatId,
      status?.result?.message_id,
      `❌ <b>OPML 导入失败</b>

${escapeHtml(
  error.message || String(error)
)}`,
      {
        inline_keyboard: [
          [
            {
              text: "⬅️ 返回",
              callback_data:
                "opml"
            }
          ]
        ]
      },
      env
    );
  }
}


async function exportOPML(
  chatId,
  env
) {

  const rows =
    await env.DB.prepare(`
      SELECT
        f.title,
        f.url,
        f.site_url
      FROM subscriptions s
      JOIN feeds f
        ON f.id=s.feed_id
      WHERE s.user_id=?
      ORDER BY f.title COLLATE NOCASE
    `)
      .bind(OWNER_ID)
      .all();


  const outlines =
    (rows.results || [])
      .map(
        feed => {

          const title =
            xmlEscape(
              feed.title ||
              feed.url
            );


          const url =
            xmlEscape(
              feed.url
            );


          const htmlUrl =
            xmlEscape(
              feed.site_url ||
              ""
            );


          return `
<outline
 type="rss"
 text="${title}"
 title="${title}"
 xmlUrl="${url}"
 htmlUrl="${htmlUrl}"
 />`;
        }
      )
      .join("");


  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">

<head>
<title>Private RSS Reader</title>
</head>

<body>
${outlines}
</body>

</opml>`;


  const blob =
    new Blob(
      [xml],
      {
        type:
          "text/x-opml;charset=utf-8"
      }
    );


  return tgDocument(
    chatId,
    blob,
    "subscriptions.opml",
    "📤 OPML 导出完成",
    env
  );
}


// ============================================================
// Add Feed
// ============================================================

async function addFeed(
  chatId,
  url,
  env
) {

  const status =
    await sendText(
      chatId,
      "⏳ 正在读取 RSS…",
      env
    );


  try {

    const feedId =
      await addFeedInternal(
        url,
        env
      );


    const feed =
      await getFeed(
        feedId,
        env
      );


    const text =
`<b>✅ 订阅已添加</b>

📡 <b>${escapeHtml(
  feed.title
)}</b>

🔗 ${escapeHtml(
  feed.url
)}

🟢 状态：推送中

历史内容已记录。

之后只推送新出现的内容。`;


    return editMessage(
      chatId,
      status?.result?.message_id,
      text,
      {
        inline_keyboard: [

          [
            {
              text: "⚙️ 订阅设置",
              callback_data:
                `feed:${feedId}`
            }
          ],

          [
            {
              text: "📡 我的订阅",
              callback_data:
                "feeds:0"
            }
          ]

        ]
      },
      env
    );

  } catch (error) {

    console.error(
      "ADD FEED",
      error
    );


    return editMessage(
      chatId,
      status?.result?.message_id,
      `<b>❌ 添加失败</b>

${escapeHtml(
  error.message ||
  String(error)
)}`,
      {
        inline_keyboard: [
          [
            {
              text: "➕ 重试",
              callback_data:
                "add"
            }
          ],
          [
            {
              text: "🏠 主菜单",
              callback_data:
                "menu"
            }
          ]
        ]
      },
      env
    );
  }
}


async function addFeedInternal(
  originalUrl,
  env
) {

  let url =
    String(originalUrl || "")
      .trim();


  url =
    await rewriteRSSHubUrl(
      url,
      env
    );


  if (!isHttpUrl(url)) {

    throw new Error(
      "URL 必须是 http(s) 地址"
    );
  }


  const xml =
    await fetchText(
      url,
      CONFIG.RSS_TIMEOUT,
      {
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
      }
    );


  const parsed =
    parseFeed(
      xml,
      url
    );


  if (!parsed.items.length) {

    throw new Error(
      "没有发现 RSS / Atom 条目"
    );
  }


  const existing =
    await env.DB.prepare(`
      SELECT id
      FROM feeds
      WHERE url=?
    `)
      .bind(url)
      .first();


  let feedId =
    existing?.id;


  if (!feedId) {

    feedId =
      crypto.randomUUID();


    await env.DB.prepare(`
      INSERT INTO feeds
      (
        id,
        url,
        title,
        description,
        site_url,
        feed_type,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        feedId,
        url,
        parsed.title ||
          new URL(url).hostname,
        parsed.description ||
          "",
        parsed.siteUrl ||
          url,
        "auto",
        now(),
        now()
      )
      .run();

  } else {

    await env.DB.prepare(`
      UPDATE feeds
      SET title=?,
          description=?,
          site_url=?,
          updated_at=?
      WHERE id=?
    `)
      .bind(
        parsed.title ||
          new URL(url).hostname,
        parsed.description ||
          "",
        parsed.siteUrl ||
          url,
        now(),
        feedId
      )
      .run();
  }


  await env.DB.prepare(`
    INSERT INTO subscriptions
    (
      id,
      user_id,
      feed_id,
      enabled,
      interval_minutes,
      next_check_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)

    ON CONFLICT(user_id, feed_id)
    DO UPDATE SET
      enabled=1,
      updated_at=excluded.updated_at
  `)
    .bind(
      crypto.randomUUID(),
      OWNER_ID,
      feedId,
      CONFIG.DEFAULT_INTERVAL,
      new Date(
        Date.now() +
        CONFIG.DEFAULT_INTERVAL *
        60000
      ).toISOString(),
      now(),
      now()
    )
    .run();


  /*
   * 核心：
   *
   * 添加订阅的时候，
   * 把当前 RSS 中已有的 Entry
   * 全部写入 feed_entries。
   *
   * 所以 Cron 第一次运行不会把旧文章发送出来。
   */
  for (
    const item of
      parsed.items.slice(
        0,
        CONFIG.MAX_ENTRIES_PER_FEED
      )
  ) {

    await seedEntry(
      env,
      feedId,
      item
    );
  }


  return feedId;
}


// ============================================================
// Scheduler
// ============================================================

async function runScheduler(env) {

  const current =
    now();


  const rows =
    await env.DB.prepare(`
      SELECT
        s.*,
        f.*
      FROM subscriptions s
      JOIN feeds f
        ON f.id=s.feed_id
      WHERE s.user_id=?
      AND s.enabled=1
      AND (
        s.next_check_at IS NULL
        OR s.next_check_at<=?
      )
      ORDER BY
        s.next_check_at
      LIMIT ?
    `)
      .bind(
        OWNER_ID,
        current,
        CONFIG.MAX_FEEDS_PER_RUN
      )
      .all();


  for (
    const row of
      rows.results || []
  ) {

    try {

      await processFeed(
        row,
        env
      );


      const minutes =
        Number(
          row.interval_minutes ||
          CONFIG.DEFAULT_INTERVAL
        );


      const next =
        new Date(
          Date.now() +
          minutes * 60000
        ).toISOString();


      await env.DB.prepare(`
        UPDATE subscriptions
        SET
          next_check_at=?,
          last_success_at=?,
          last_error=NULL,
          updated_at=?
        WHERE user_id=?
        AND feed_id=?
      `)
        .bind(
          next,
          now(),
          now(),
          OWNER_ID,
          row.feed_id
        )
        .run();

    } catch (error) {

      console.error(
        "FEED ERROR",
        row.url,
        error
      );


      const minutes =
        Math.max(
          10,
          Number(
            row.interval_minutes ||
            CONFIG.DEFAULT_INTERVAL
          )
        );


      const next =
        new Date(
          Date.now() +
          minutes * 60000
        ).toISOString();


      await env.DB.prepare(`
        UPDATE subscriptions
        SET
          next_check_at=?,
          last_error=?,
          updated_at=?
        WHERE user_id=?
        AND feed_id=?
      `)
        .bind(
          next,
          String(
            error.message ||
            error
          ).slice(0, 1000),
          now(),
          OWNER_ID,
          row.feed_id
        )
        .run();
    }
  }
}


// ============================================================
// Process Feed
// ============================================================

async function processFeed(
  feed,
  env
) {

  const xml =
    await fetchText(
      feed.url,
      CONFIG.RSS_TIMEOUT,
      {
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
      }
    );


  const parsed =
    parseFeed(
      xml,
      feed.url
    );


  if (!parsed.items.length) {
    return;
  }


  const newItems = [];


  for (
    const item of
      parsed.items.slice(
        0,
        CONFIG.MAX_ENTRIES_PER_FEED
      )
  ) {

    const id =
      entryStableId(
        feed.feed_id,
        item
      );


    const existing =
      await env.DB.prepare(`
        SELECT id
        FROM feed_entries
        WHERE id=?
      `)
        .bind(id)
        .first();


    if (!existing) {

      newItems.push({
        id,
        item,
      });
    }
  }


  /*
   * RSS 通常最新文章在前面。
   *
   * 这里 reverse 后，
   * 按发布时间从旧到新发送。
   */
  newItems.reverse();


  for (
    const entry of
      newItems
  ) {

    const allowed =
      await passesFilters(
        entry.item,
        feed.feed_id,
        env
      );


    /*
     * 即使被过滤掉，
     * 也要记录 Entry。
     *
     * 否则下一轮会一直重复检查。
     */
    if (!allowed) {

      await seedEntry(
        env,
        feed.feed_id,
        entry.item,
        entry.id
      );

      continue;
    }


    await deliverEntry(
      feed,
      entry.item,
      env
    );


    await seedEntry(
      env,
      feed.feed_id,
      entry.item,
      entry.id
    );
  }
}


// ============================================================
// Filters
// ============================================================

async function passesFilters(
  item,
  feedId,
  env
) {

  const rows =
    await env.DB.prepare(`
      SELECT mode, keyword
      FROM filters
      WHERE feed_id=?
    `)
      .bind(feedId)
      .all();


  const filters =
    rows.results || [];


  if (!filters.length) {
    return true;
  }


  const haystack =
    (
      String(item.title || "") +
      "\n" +
      String(item.summary || "") +
      "\n" +
      stripHtml(
        item.content || ""
      )
    ).toLocaleLowerCase();


  const includes =
    filters.filter(
      x => x.mode === "include"
    );


  const excludes =
    filters.filter(
      x => x.mode === "exclude"
    );


  if (
    excludes.some(
      x =>
        haystack.includes(
          String(
            x.keyword
          ).toLocaleLowerCase()
        )
    )
  ) {

    return false;
  }


  if (
    includes.length &&
    !includes.some(
      x =>
        haystack.includes(
          String(
            x.keyword
          ).toLocaleLowerCase()
        )
    )
  ) {

    return false;
  }


  return true;
}


// ============================================================
// Renderer
// ============================================================

async function deliverEntry(
  feed,
  item,
  env
) {

  const type =
    feed.feed_type === "auto"
      ? classifyEntry(item)
      : feed.feed_type;


  if (type === "media") {

    if (item.media.length) {

      return deliverMedia(
        feed,
        item,
        env
      );
    }

    return deliverText(
      feed,
      item,
      env
    );
  }


  if (type === "article") {

    return deliverArticle(
      feed,
      item,
      env
    );
  }


  if (type === "text") {

    return deliverText(
      feed,
      item,
      env
    );
  }


  if (item.media.length) {

    return deliverMedia(
      feed,
      item,
      env
    );
  }


  /*
   * 有文章链接并且正文较长，
   * 使用 Telegraph。
   */
  if (
    item.link &&
    (
      stripHtml(
        item.content || ""
      ).length > 500 ||
      stripHtml(
        item.summary || ""
      ).length > 500
    )
  ) {

    return deliverArticle(
      feed,
      item,
      env
    );
  }


  return deliverText(
    feed,
    item,
    env
  );
}


function classifyEntry(item) {

  if (
    item.media &&
    item.media.length
  ) {

    return "media";
  }


  const text =
    stripHtml(
      item.content ||
      item.summary ||
      ""
    );


  if (
    item.link &&
    text.length > 300
  ) {

    return "article";
  }


  return "text";
}


// ============================================================
// Media Renderer
// ============================================================

async function deliverMedia(
  feed,
  item,
  env
) {

  const media =
    (item.media || [])
      .filter(
        m =>
          isHttpUrl(m.url)
      );


  if (!media.length) {

    return deliverText(
      feed,
      item,
      env
    );
  }


  const caption =
    buildMediaCaption(
      feed,
      item
    );


  /*
   * Telegram sendMediaGroup
   * 每组最多 10 个媒体。
   */
  const groups = [];


  for (
    let i = 0;
    i < media.length;
    i += CONFIG.MAX_MEDIA_PER_GROUP
  ) {

    groups.push(
      media.slice(
        i,
        i + CONFIG.MAX_MEDIA_PER_GROUP
      )
    );
  }


  for (
    let groupIndex = 0;
    groupIndex < groups.length;
    groupIndex++
  ) {

    const group =
      groups[groupIndex];


    if (group.length === 1) {

      await sendSingleMedia(
        OWNER_ID,
        group[0],
        groupIndex === 0
          ? caption
          : "",
        env
      );

      continue;
    }


    const payload =
      group.map(
        (mediaItem, index) => {

          const input =
            mediaInput(
              mediaItem
            );


          /*
           * 只有第一组第一个媒体
           * 放正文。
           */
          if (
            groupIndex === 0 &&
            index === 0
          ) {

            input.caption =
              caption;

            input.parse_mode =
              "HTML";
          }


          return input;
        }
      );


    await tg(
      "sendMediaGroup",
      {
        chat_id: OWNER_ID,
        media: payload
      },
      env
    );
  }


  /*
   * 原文单独放在最后。
   */
  if (item.link) {

    await sendText(
      OWNER_ID,
      "🔗 <b>查看原文</b>",
      env,
      [
        [
          {
            text: "打开原文",
            url: item.link
          }
        ]
      ]
    );
  }
}


function mediaInput(media) {

  const type =
    media.type === "video"
      ? "video"
      : media.type === "animation"
        ? "animation"
        : "photo";


  return {
    type,
    media: media.url,
  };
}


async function sendSingleMedia(
  chatId,
  media,
  caption,
  env,
  keyboard
) {

  const replyMarkup =
    keyboard
      ? JSON.stringify({
          inline_keyboard:
            keyboard
        })
      : undefined;


  if (
    media.type === "video"
  ) {

    return tg(
      "sendVideo",
      {
        chat_id: chatId,
        video: media.url,
        caption:
          caption || undefined,
        parse_mode:
          caption
            ? "HTML"
            : undefined,
        reply_markup:
          replyMarkup
      },
      env
    );
  }


  if (
    media.type === "animation"
  ) {

    return tg(
      "sendAnimation",
      {
        chat_id: chatId,
        animation: media.url,
        caption:
          caption || undefined,
        parse_mode:
          caption
            ? "HTML"
            : undefined,
        reply_markup:
          replyMarkup
      },
      env
    );
  }


  return tg(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: media.url,
      caption:
        caption || undefined,
      parse_mode:
        caption
          ? "HTML"
          : undefined,
      reply_markup:
        replyMarkup
    },
    env
  );
}


function buildMediaCaption(
  feed,
  item
) {

  let text =
`<b>📡 ${escapeHtml(
  feed.title ||
  "RSS"
)}</b>`;


  if (item.author) {

    text +=
      `\n\n👤 ${escapeHtml(
        item.author
      )}`;
  }


  if (item.title) {

    text +=
      `\n\n<b>${escapeHtml(
        item.title
      )}</b>`;
  }


  const body =
    stripHtml(
      item.summary ||
      item.content ||
      ""
    );


  if (body) {

    text +=
      `\n\n${escapeHtml(
        body.slice(
          0,
          CONFIG.MAX_CAPTION - 150
        )
      )}`;
  }


  return text.slice(
    0,
    CONFIG.MAX_CAPTION
  );
}


// ============================================================
// Article Renderer
// ============================================================

async function deliverArticle(
  feed,
  item,
  env
) {

  let telegraphUrl =
    null;


  try {

    telegraphUrl =
      await createTelegraphArticle(
        feed,
        item,
        env
      );

  } catch (error) {

    console.error(
      "TELEGRAPH ERROR",
      error
    );
  }


  const text =
    buildArticleCard(
      feed,
      item
    );


  const keyboard = [];


  if (telegraphUrl) {

    keyboard.push([
      {
        text: "📖 阅读全文",
        url: telegraphUrl
      }
    ]);
  }


  if (item.link) {

    keyboard.push([
      {
        text: "🔗 查看原文",
        url: item.link
      }
    ]);
  }


  /*
   * 如果文章有首图，
   * 使用图片 + caption。
   */
  if (
    item.media?.[0]
  ) {

    return sendSingleMedia(
      OWNER_ID,
      item.media[0],
      text,
      env,
      keyboard
    );
  }


  return sendText(
    OWNER_ID,
    text,
    env,
    keyboard
  );
}


function buildArticleCard(
  feed,
  item
) {

  let text =
`<b>📰 ${escapeHtml(
  feed.title ||
  "RSS"
)}</b>

<b>${escapeHtml(
  item.title ||
  "无标题"
)}</b>`;


  if (item.author) {

    text +=
      `\n\n👤 ${escapeHtml(
        item.author
      )}`;
  }


  if (item.publishedAt) {

    text +=
      `\n🕒 ${escapeHtml(
        formatDate(
          item.publishedAt
        )
      )}`;
  }


  const summary =
    stripHtml(
      item.summary ||
      item.content ||
      ""
    );


  if (summary) {

    text +=
      `\n\n${escapeHtml(
        summary.slice(
          0,
          2400
        )
      )}`;
  }


  return text.slice(
    0,
    CONFIG.MAX_TELEGRAM_TEXT
  );
}


// ============================================================
// Telegraph
// ============================================================

async function createTelegraphArticle(
  feed,
  item,
  env
) {

  const token =
    await getTelegraphToken(
      env
    );


  let html =
    item.content ||
    item.summary ||
    "";


  /*
   * RSS 没有全文时，
   * 尝试抓原网页。
   */
  if (
    stripHtml(html).length < 500 &&
    item.link
  ) {

    try {

      const page =
        await fetchText(
          item.link,
          CONFIG.ARTICLE_TIMEOUT,
          {
            Accept:
              "text/html,application/xhtml+xml,*/*"
          }
        );


      const extracted =
        extractArticleBody(
          page,
          item.link
        );


      if (extracted) {
        html = extracted;
      }

    } catch (error) {

      console.error(
        "ARTICLE FETCH",
        error
      );
    }
  }


  const nodes =
    htmlToTelegraphNodes(
      html,
      item.media,
      item.link
    );


  if (!nodes.length) {

    throw new Error(
      "文章正文为空"
    );
  }


  const title =
    (
      item.title ||
      feed.title ||
      "RSS Article"
    ).slice(
      0,
      256
    );


  const response =
    await fetch(
      `${CONFIG.TELEGRAPH_API}/createPage`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            access_token: token,

            title,

            author_name:
              item.author ||
              feed.title ||
              "RSS Reader",

            content:
              JSON.stringify(nodes),

            return_content:
              "false"
          })
      }
    );


  const result =
    await response.json();


  if (!result.ok) {

    throw new Error(
      result.error ||
      "Telegraph createPage failed"
    );
  }


  return (
    "https://telegra.ph/" +
    result.result.path
  );
}


async function getTelegraphToken(
  env
) {

  /*
   * 推荐在 Worker Secret 中设置：
   *
   * TELEGRAPH_ACCESS_TOKEN
   *
   * 如果没有设置，
   * 第一次调用会创建 Telegraph account。
   */
  if (
    env.TELEGRAPH_ACCESS_TOKEN
  ) {

    return env.TELEGRAPH_ACCESS_TOKEN;
  }


  const response =
    await fetch(
      `${CONFIG.TELEGRAPH_API}/createAccount`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            short_name:
              "PrivateRSSReader",

            author_name:
              "RSS Reader"
          })
      }
    );


  const result =
    await response.json();


  if (!result.ok) {

    throw new Error(
      result.error ||
      "Telegraph account creation failed"
    );
  }


  return result.result.access_token;
}


// ============================================================
// Article HTML
// ============================================================

function extractArticleBody(
  html,
  baseUrl
) {

  let clean =
    cleanArticleHtml(
      html
    );


  const candidates = [
    ...clean.matchAll(
      /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi
    )
  ]
    .map(
      match =>
        match[2]
    );


  let body =
    candidates.sort(
      (a, b) =>
        stripHtml(b).length -
        stripHtml(a).length
    )[0] || "";


  if (!body) {

    const paragraphs = [
      ...clean.matchAll(
        /<p\b[^>]*>[\s\S]*?<\/p>/gi
      )
    ]
      .map(
        match =>
          match[0]
      );


    body =
      paragraphs.join("\n");
  }


  if (!body) {
    return "";
  }


  body =
    body.replace(
      /<img\b[^>]*>/gi,
      tag => {

        const src =
          attr(
            tag,
            "src"
          ) ||
          attr(
            tag,
            "data-src"
          );


        if (!src) {
          return "";
        }


        try {

          return `<img src="${new URL(
            src,
            baseUrl
          ).href}">`;

        } catch {

          return "";
        }
      }
    );


  return body;
}


function cleanArticleHtml(
  html
) {

  return String(
    html || ""
  )
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ""
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ""
    )
    .replace(
      /<(nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    )
    .replace(
      /\son[a-z]+\s*=\s*(["']).*?\1/gi,
      ""
    )
    .slice(
      0,
      CONFIG.MAX_ARTICLE_LENGTH
    );
}


function htmlToTelegraphNodes(
  html,
  media = [],
  baseUrl = ""
) {

  let clean =
    cleanArticleHtml(
      html
    );


  clean =
    clean.replace(
      /<img\b[^>]*>/gi,
      tag => {

        const src =
          attr(
            tag,
            "src"
          ) ||
          attr(
            tag,
            "data-src"
          );


        if (!src) {
          return "";
        }


        try {

          return `<img src="${new URL(
            src,
            baseUrl || undefined
          ).href}">`;

        } catch {

          return "";
        }
      }
    );


  const nodes = [];


  const regex =
    /<(h[1-6]|p|blockquote|pre|ul|ol|li)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*>|<br\s*\/?>/gi;


  let match;

  let count = 0;


  while (
    (match = regex.exec(clean)) &&
    count < 250
  ) {

    const whole =
      match[0];


    const tag =
      (
        match[1] ||
        (
          /^<img/i.test(whole)
            ? "img"
            : "br"
        )
      ).toLowerCase();


    if (tag === "img") {

      const src =
        attr(
          whole,
          "src"
        );


      if (
        isHttpUrl(src)
      ) {

        nodes.push({
          tag: "img",

          attrs: {
            src
          }
        });
      }


      count++;

      continue;
    }


    if (tag === "br") {

      nodes.push({
        tag: "br"
      });


      count++;

      continue;
    }


    const inner =
      match[2] || "";


    const text =
      stripHtml(
        inner
      );


    if (!text) {
      continue;
    }


    if (tag === "pre") {

      nodes.push({
        tag: "pre",

        children: [
          {
            tag: "code",

            children: [
              text.slice(
                0,
                10000
              )
            ]
          }
        ]
      });

    } else if (
      tag === "blockquote"
    ) {

      nodes.push({
        tag: "blockquote",

        children: [
          text.slice(
            0,
            5000
          )
        ]
      });

    } else if (
      tag === "ul" ||
      tag === "ol"
    ) {

      nodes.push({
        tag,

        children: [
          {
            tag: "li",

            children: [
              text.slice(
                0,
                5000
              )
            ]
          }
        ]
      });

    } else {

      nodes.push({
        tag,

        children: [
          text.slice(
            0,
            10000
          )
        ]
      });
    }


    count++;
  }


  if (!nodes.length) {

    const text =
      stripHtml(
        clean
      ).slice(
        0,
        CONFIG.MAX_ARTICLE_LENGTH
      );


    if (text) {

      return [
        {
          tag: "p",
          children: [
            text
          ]
        }
      ];
    }
  }


  return nodes;
}


// ============================================================
// RSS Parser
// ============================================================

function parseFeed(
  xml,
  sourceUrl
) {

  const isAtom =
    /<feed\b/i.test(xml) &&
    /<entry\b/i.test(xml);


  const title =
    decodeXml(
      firstTag(
        xml,
        "title"
      )
    ).trim();


  const description =
    decodeXml(
      firstTag(
        xml,
        isAtom
          ? "subtitle"
          : "description"
      )
    ).trim();


  const siteUrl =
    isAtom
      ? (
          firstLink(xml) ||
          sourceUrl
        )
      : (
          decodeXml(
            firstTag(
              xml,
              "link"
            )
          ).trim() ||
          sourceUrl
        );


  const blocks =
    extractBlocks(
      xml,
      isAtom
        ? "entry"
        : "item"
    );


  const items =
    blocks
      .map(
        block =>
          parseEntry(
            block,
            isAtom
          )
      )
      .filter(
        item =>
          item.title ||
          item.link ||
          item.content
      );


  return {
    title,
    description,
    siteUrl,
    items
  };
}


function parseEntry(
  block,
  isAtom
) {

  const title =
    decodeXml(
      stripHtml(
        firstTag(
          block,
          "title"
        )
      )
    ).trim();


  const guid =
    decodeXml(
      (
        isAtom
          ? firstTag(
              block,
              "id"
            )
          : firstTag(
              block,
              "guid"
            )
      ) || ""
    ).trim();


  const link =
    isAtom
      ? (
          firstLink(block) ||
          ""
        )
      : decodeXml(
          firstTag(
            block,
            "link"
          )
        ).trim();


  const summary =
    decodeXml(
      firstTag(
        block,
        isAtom
          ? "summary"
          : "description"
      )
    ).trim();


  const content =
    decodeXml(
      firstTag(
        block,
        isAtom
          ? "content"
          : "content:encoded"
      ) ||
      summary
    ).trim();


  const author =
    decodeXml(
      firstTag(
        block,
        "name"
      ) ||
      firstTag(
        block,
        "dc:creator"
      ) ||
      ""
    ).trim();


  const publishedRaw =
    firstTag(
      block,
      isAtom
        ? "published"
        : "pubDate"
    ) ||
    firstTag(
      block,
      "updated"
    ) ||
    firstTag(
      block,
      "dc:date"
    ) ||
    "";


  const publishedAt =
    toIso(
      publishedRaw
    );


  const media = [];


  // RSS enclosure
  for (
    const match of block.matchAll(
      /<enclosure\b[^>]*>/gi
    )
  ) {

    const tag =
      match[0];


    const url =
      attr(
        tag,
        "url"
      );


    const type =
      attr(
        tag,
        "type"
      );


    if (
      isHttpUrl(url)
    ) {

      media.push({
        url,
        type:
          mediaType(
            type,
            url
          )
      });
    }
  }


  // media:content
  for (
    const match of block.matchAll(
      /<(media:content|media:thumbnail)\b[^>]*>/gi
    )
  ) {

    const tag =
      match[0];


    const url =
      attr(
        tag,
        "url"
      );


    const type =
      attr(
        tag,
        "type"
      );


    if (
      isHttpUrl(url) &&
      !media.some(
        x =>
          x.url === url
      )
    ) {

      media.push({
        url,
        type:
          mediaType(
            type,
            url
          )
      });
    }
  }


  // 图片
  for (
    const match of content.matchAll(
      /<img\b[^>]*>/gi
    )
  ) {

    const tag =
      match[0];


    const url =
      attr(
        tag,
        "src"
      ) ||
      attr(
        tag,
        "data-src"
      );


    if (
      isHttpUrl(url) &&
      !media.some(
        x =>
          x.url === url
      )
    ) {

      media.push({
        url,
        type: "photo"
      });
    }
  }


  return {
    title,
    guid,
    link,
    summary,
    content,
    author,
    publishedAt,
    media:
      media.slice(
        0,
        30
      )
  };
}


// ============================================================
// RSSHub
// ============================================================

async function rewriteRSSHubUrl(
  url,
  env
) {

  const settings =
    await getSettings(
      env,
      OWNER_ID
    );


  const instance =
    normalizeBaseUrl(
      settings.rsshub_instance ||
      CONFIG.DEFAULT_RSSHUB
    );


  if (!instance) {
    return url;
  }


  try {

    const parsed =
      new URL(url);


    const defaultHub =
      new URL(
        CONFIG.DEFAULT_RSSHUB
      );


    if (
      parsed.origin ===
      defaultHub.origin
    ) {

      return (
        instance +
        parsed.pathname +
        parsed.search
      );
    }


    return url;

  } catch {

    return url;
  }
}


// ============================================================
// Database Helpers
// ============================================================

async function getFeed(
  id,
  env
) {

  return env.DB.prepare(`
    SELECT *
    FROM feeds
    WHERE id=?
  `)
    .bind(id)
    .first();
}


async function getSettings(
  env,
  userId
) {

  let row =
    await env.DB.prepare(`
      SELECT *
      FROM user_settings
      WHERE user_id=?
    `)
      .bind(userId)
      .first();


  if (!row) {

    await env.DB.prepare(`
      INSERT OR IGNORE INTO user_settings
      (
        user_id,
        rsshub_instance,
        language
      )
      VALUES (?, ?, ?)
    `)
      .bind(
        userId,
        CONFIG.DEFAULT_RSSHUB,
        "zh-CN"
      )
      .run();


    row =
      await env.DB.prepare(`
        SELECT *
        FROM user_settings
        WHERE user_id=?
      `)
        .bind(userId)
        .first();
  }


  return row;
}


async function setState(
  env,
  userId,
  state
) {

  await env.DB.prepare(`
    INSERT INTO user_states
    (
      user_id,
      state_json,
      updated_at
    )
    VALUES (?, ?, ?)

    ON CONFLICT(user_id)
    DO UPDATE SET
      state_json=excluded.state_json,
      updated_at=excluded.updated_at
  `)
    .bind(
      userId,
      JSON.stringify(state),
      now()
    )
    .run();
}


async function getState(
  env,
  userId
) {

  const row =
    await env.DB.prepare(`
      SELECT state_json
      FROM user_states
      WHERE user_id=?
    `)
      .bind(userId)
      .first();


  if (!row) {
    return null;
  }


  try {

    return JSON.parse(
      row.state_json
    );

  } catch {

    return null;
  }
}


async function clearState(
  env,
  userId
) {

  await env.DB.prepare(`
    DELETE FROM user_states
    WHERE user_id=?
  `)
    .bind(userId)
    .run();
}


async function seedEntry(
  env,
  feedId,
  item,
  id = entryStableId(
    feedId,
    item
  )
) {

  await env.DB.prepare(`
    INSERT OR IGNORE INTO feed_entries
    (
      id,
      feed_id,
      guid,
      url,
      title,
      summary,
      content,
      published_at,
      content_hash,
      discovered_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id,
      feedId,
      item.guid ||
        item.link ||
        item.title ||
        crypto.randomUUID(),

      item.link ||
        "",

      item.title ||
        "",

      item.summary ||
        "",

      item.content ||
        "",

      item.publishedAt ||
        now(),

      hashString(
        item.guid ||
        item.link ||
        item.title ||
        item.content ||
        ""
      ),

      now()
    )
    .run();
}


function entryStableId(
  feedId,
  item
) {

  return hashString(
    `${feedId}|${
      item.guid ||
      item.link ||
      item.title ||
      hashString(
        item.content ||
        ""
      )
    }`
  );
}


// ============================================================
// Telegram Helpers
// ============================================================

async function sendText(
  chatId,
  text,
  env,
  keyboard
) {

  const payload = {

    chat_id:
      chatId,

    text:
      text ||
      "\u200b",

    parse_mode:
      "HTML",

    disable_web_page_preview:
      true,

  };


  if (keyboard) {

    payload.reply_markup =
      JSON.stringify({
        inline_keyboard:
          keyboard
      });
  }


  return tg(
    "sendMessage",
    payload,
    env
  );
}


async function editMessage(
  chatId,
  messageId,
  text,
  keyboard,
  env
) {

  if (!messageId) {

    return sendText(
      chatId,
      text,
      env,
      keyboard?.inline_keyboard
    );
  }


  return tg(
    "editMessageText",
    {
      chat_id:
        chatId,

      message_id:
        messageId,

      text,

      parse_mode:
        "HTML",

      disable_web_page_preview:
        true,

      reply_markup:
        keyboard
          ? JSON.stringify(
              keyboard
            )
          : undefined
    },
    env
  );
}


async function editOrSend(
  chatId,
  messageId,
  text,
  keyboard,
  env
) {

  if (messageId) {

    return editMessage(
      chatId,
      messageId,
      text,
      keyboard,
      env
    );
  }


  return sendText(
    chatId,
    text,
    env,
    keyboard?.inline_keyboard
  );
}


async function tg(
  method,
  payload,
  env
) {

  const clean =
    Object.fromEntries(
      Object.entries(
        payload || {}
      )
        .filter(
          ([, value]) =>
            value !== undefined
        )
    );


  const response =
    await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(clean)
      }
    );


  const result =
    await response.json();


  if (!result.ok) {

    throw new Error(
      `Telegram ${method}: ${
        result.description ||
        "API error"
      }`
    );
  }


  return result;
}


async function tgDocument(
  chatId,
  blob,
  filename,
  caption,
  env
) {

  const form =
    new FormData();


  form.append(
    "chat_id",
    chatId
  );


  form.append(
    "document",
    blob,
    filename
  );


  form.append(
    "caption",
    caption
  );


  const response =
    await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`,
      {
        method: "POST",
        body: form
      }
    );


  const result =
    await response.json();


  if (!result.ok) {

    throw new Error(
      result.description ||
      "sendDocument failed"
    );
  }


  return result;
}


// ============================================================
// HTTP
// ============================================================

async function fetchText(
  url,
  timeout,
  headers = {}
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );


  try {

    const response =
      await fetch(
        url,
        {
          redirect: "follow",

          signal:
            controller.signal,

          headers: {
            "user-agent":
              CONFIG.USER_AGENT,

            ...headers
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    return await response.text();

  } finally {

    clearTimeout(timer);
  }
}


// ============================================================
// OPML
// ============================================================

function parseOPML(
  xml
) {

  const urls = [];


  for (
    const match of
      xml.matchAll(
        /<outline\b[^>]*>/gi
      )
  ) {

    const tag =
      match[0];


    const url =
      attr(
        tag,
        "xmlUrl"
      ) ||
      attr(
        tag,
        "xmlurl"
      );


    if (
      isHttpUrl(url) &&
      !urls.includes(url)
    ) {

      urls.push(url);
    }
  }


  return urls;
}


// ============================================================
// XML
// ============================================================

function extractBlocks(
  xml,
  tag
) {

  const regex =
    new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi"
    );


  return [
    ...xml.matchAll(regex)
  ]
    .map(
      match =>
        match[0]
    );
}


function firstTag(
  xml,
  tag
) {

  const safe =
    tag.replace(
      ":",
      "\\:"
    );


  const regex =
    new RegExp(
      `<${safe}\\b[^>]*>([\\s\\S]*?)<\\/${safe}>`,
      "i"
    );


  const match =
    xml.match(regex);


  return match
    ? match[1]
    : "";
}


function firstLink(
  xml
) {

  const normal =
    xml.match(
      /<link\b([^>]*)>([\s\S]*?)<\/link>/i
    );


  if (normal) {

    const href =
      attr(
        normal[0],
        "href"
      );


    if (href) {
      return decodeXml(href);
    }


    return decodeXml(
      normal[2] || ""
    ).trim();
  }


  const self =
    xml.match(
      /<link\b([^>]*)\/?>/i
    );


  return self
    ? decodeXml(
        attr(
          self[0],
          "href"
        ) || ""
      )
    : "";
}


function attr(
  tag,
  name
) {

  const regex =
    new RegExp(
      `${name}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`,
      "i"
    );


  const match =
    tag.match(regex);


  return match
    ? decodeXml(
        match[2]
      )
    : "";
}


function decodeXml(
  value
) {

  return String(
    value || ""
  )
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#39;/g,
      "'"
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&#(\d+);/g,
      (_, n) =>
        String.fromCodePoint(
          Number(n)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCodePoint(
          parseInt(
            n,
            16
          )
        )
    );
}


// ============================================================
// Utility
// ============================================================

function isHttpUrl(
  value
) {

  try {

    const url =
      new URL(
        String(value)
      );


    return (
      url.protocol ===
        "http:" ||
      url.protocol ===
        "https:"
    );

  } catch {

    return false;
  }
}


function normalizeBaseUrl(
  value
) {

  try {

    const url =
      new URL(
        String(value)
      );


    if (
      !/^https?:$/.test(
        url.protocol
      )
    ) {

      return null;
    }


    return url.origin;

  } catch {

    return null;
  }
}


function stripHtml(
  value
) {

  return String(
    value || ""
  )
    .replace(
      /<br\s*\/?>/gi,
      "\n"
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    );
}


function xmlEscape(
  value
) {

  return escapeHtml(
    value
  );
}


function mediaType(
  type,
  url
) {

  const value =
    String(
      type || ""
    ).toLowerCase();


  if (
    value.includes(
      "video"
    )
  ) {

    return "video";
  }


  if (
    value.includes(
      "gif"
    )
  ) {

    return "animation";
  }


  if (
    /\.(mp4|webm|mov)(\?|$)/i.test(
      url
    )
  ) {

    return "video";
  }


  if (
    /\.gif(\?|$)/i.test(
      url
    )
  ) {

    return "animation";
  }


  return "photo";
}


function toIso(
  value
) {

  if (!value) {
    return now();
  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return now();
  }


  return date.toISOString();
}


function formatDate(
  value
) {

  try {

    return new Date(
      value
    ).toLocaleString(
      "zh-CN",
      {
        timeZone:
          "Asia/Shanghai",

        hour12:
          false
      }
    );

  } catch {

    return String(value);
  }
}


function now() {

  return new Date()
    .toISOString();
}


function hashString(
  value
) {

  let hash =
    2166136261;


  const text =
    String(
      value || ""
    );


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    hash ^=
      text.charCodeAt(i);


    hash =
      Math.imul(
        hash,
        16777619
      );
  }


  return (
    hash >>> 0
  ).toString(16);
}


function json(
  value,
  status = 200
) {

  return new Response(
    JSON.stringify(value),
    {
      status,

      headers: {
        "content-type":
          "application/json;charset=utf-8"
      }
    }
  );
}


// ============================================================
// Exports
// ============================================================

export {
  parseFeed,
  parseOPML,
  classifyEntry,
  normalizeBaseUrl,
  escapeHtml,
  mediaType
};
