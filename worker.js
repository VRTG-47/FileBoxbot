const OWNER_ID = "7559560220";
const BOT_NAME = "伊蕾希娅";

const PAGE_SIZE = 8;
const SEARCH_PAGE_SIZE = 8;
const MAX_INLINE = 20;
const MEDIA_GROUP_WAIT = 600;

// ============================================================
// Cloudflare Worker
// Telegram Private File Manager
//
// D1:
//   files
//   folders
//   user_states
//
// Required secrets:
//   BOT_TOKEN
//
// Recommended indexes:
//
// CREATE UNIQUE INDEX IF NOT EXISTS
// idx_files_user_dedupe
// ON files(user_id, file_unique_id);
//
// CREATE UNIQUE INDEX IF NOT EXISTS
// idx_files_user_custom_id
// ON files(user_id, custom_id);
//
// CREATE INDEX IF NOT EXISTS
// idx_files_user_folder
// ON files(user_id, folder_id);
//
// CREATE INDEX IF NOT EXISTS
// idx_files_user_created
// ON files(user_id, created_at);
//
// CREATE INDEX IF NOT EXISTS
// idx_folders_user_parent
// ON folders(user_id, parent_id);
// ============================================================

export default {
  async fetch(request, env) {
    try {
      if (request.method === "GET") {
        return new Response(
          `${BOT_NAME}在这里等候主人。`
        );
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405
        });
      }

      const update = await request.json();

      await handleUpdate(update, env);

      return new Response("OK");
    } catch (e) {
      console.error(
        "WORKER ERROR",
        e?.stack || e
      );

      return new Response(
        "Internal Server Error",
        {
          status: 500
        }
      );
    }
  }
};


// ============================================================
// Telegram API
// ============================================================

async function telegram(method, body, env) {
  const r = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await r.json();

  if (!data.ok) {
    console.error(
      "Telegram API Error:",
      method,
      data
    );
  }

  return data;
}


async function sendMessage(
  chatId,
  text,
  options = {},
  env
) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...options
    },
    env
  );
}


async function editMessage(
  chatId,
  messageId,
  text,
  options = {},
  env
) {
  return telegram(
    "editMessageText",
    {
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      parse_mode: "HTML",
      ...options
    },
    env
  );
}


async function answerCallback(
  callbackQueryId,
  text = "",
  showAlert = false,
  env
) {
  return telegram(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      ...(text
        ? {
            text
          }
        : {}),
      show_alert: showAlert
    },
    env
  );
}


// ============================================================
// Update router
// ============================================================

async function handleUpdate(update, env) {
  if (update.inline_query) {
    return handleInlineQuery(
      update.inline_query,
      env
    );
  }

  if (update.callback_query) {
    const q = update.callback_query;

    const userId =
      String(q.from?.id || "");

    if (userId !== OWNER_ID) {
      return answerCallback(
        q.id,
        "这是主人的私人文件库。",
        true,
        env
      );
    }

    return handleCallback(
      q,
      env
    );
  }

  if (!update.message) {
    return;
  }

  const m = update.message;

  const userId =
    String(
      m.from?.id ??
      m.chat?.id ??
      ""
    );

  const chatId =
    String(
      m.chat?.id ??
      ""
    );

  if (userId !== OWNER_ID) {
    return sendMessage(
      chatId,
      "抱歉，这里是主人的私人文件库。",
      {},
      env
    );
  }

  if (
    m.document ||
    m.video ||
    m.audio ||
    m.photo ||
    m.animation ||
    m.voice ||
    m.video_note
  ) {
    return handleMediaMessage(
      m,
      env
    );
  }

  if (m.text) {
    return handleText(
      m,
      env
    );
  }
}


// ============================================================
// Home
// ============================================================

function homeKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "📄 最近资源",
          callback_data: "home:recent"
        },
        {
          text: "📁 文件夹",
          callback_data: "home:folders"
        }
      ],
      [
        {
          text: "🔎 搜索",
          callback_data: "home:search"
        },
        {
          text: "❓ 帮助",
          callback_data: "home:help"
        }
      ]
    ]
  };
}


async function sendHome(
  chatId,
  env
) {
  return sendMessage(
    chatId,
    `<b>${BOT_NAME} 文件管家</b>\n\n` +
      `欢迎回来，主人。\n` +
      `这里是你的私人 Telegram 文件库。\n\n` +
      `📦 文件储存在 Telegram\n` +
      `📁 D1 保存目录与索引\n` +
      `🔎 支持文件名 / ID 搜索\n` +
      `🆔 每个资源拥有独立 ID`,
    {
      reply_markup:
        homeKeyboard()
    },
    env
  );
}


async function sendHelp(
  chatId,
  env
) {
  return sendMessage(
    chatId,
    `<b>${BOT_NAME} 文件管家</b>\n\n` +

      `<b>📁 文件夹</b>\n` +
      `创建 游戏\n` +
      `创建 游戏/FGO/攻略\n` +
      `打开 游戏/FGO\n` +
      `删除 游戏/FGO\n` +
      `把 FGO 改名为 命运冠位指定\n\n` +

      `<b>📦 文件</b>\n` +
      `直接发送文件、图片、视频、音频。\n` +
      `发送链接也可以直接归档。\n\n` +

      `<b>🔎 搜索</b>\n` +
      `可以搜索文件名、自定义 ID、文件夹。\n\n` +

      `<b>🆔 ID</b>\n` +
      `每个资源都会自动获得唯一 ID。\n` +
      `详情页可以修改 ID。\n\n` +

      `<b>📤 取出</b>\n` +
      `取出资源后，会在实际资源消息下面显示上一项 / 下一项。`,
    {},
    env
  );
}


// ============================================================
// Text
// ============================================================

async function handleText(m, env) {
  const userId =
    String(
      m.from?.id ??
      m.chat.id
    );

  const chatId =
    String(m.chat.id);

  const text =
    String(
      m.text || ""
    ).trim();

  if (text === "/start") {
    await clearState(
      userId,
      env
    );

    return sendHome(
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

  const state =
    await getState(
      userId,
      env
    );

  if (
    state &&
    !state.startsWith(
      "pending_resource:"
    )
  ) {
    const handled =
      await handleState(
        m,
        state,
        env
      );

    if (handled) {
      return;
    }
  }

  if (
    text === "📄 我的文件"
  ) {
    return showRecentFiles(
      userId,
      chatId,
      0,
      env
    );
  }

  if (
    text === "📁 文件夹"
  ) {
    return showFolderRoot(
      userId,
      chatId,
      0,
      env
    );
  }

  if (
    text === "🔎 搜索"
  ) {
    await setState(
      userId,
      "search",
      env
    );

    return sendMessage(
      chatId,
      "主人想找什么？\n\n" +
        "可以输入文件名、文件 ID 或关键词。",
      {},
      env
    );
  }

  if (containsUrl(text)) {
    return handleLinkMessage(
      m,
      env
    );
  }

  if (
    await parseNaturalLanguage(
      text,
      userId,
      chatId,
      env
    )
  ) {
    return;
  }

  return sendMessage(
    chatId,
    `主人，我暂时没理解这句话。\n\n` +
      `📁 <code>创建 游戏/FGO</code>\n` +
      `📂 <code>打开 游戏/FGO</code>\n` +
      `🔎 <code>搜索 FGO</code>\n` +
      `📦 <code>把刚才那个资源放到 游戏/FGO</code>\n` +
      `🗑 <code>删除 游戏/FGO</code>`,
    {},
    env
  );
}


// ============================================================
// Resource intake
// ============================================================

async function handleMediaMessage(
  m,
  env
) {
  const userId =
    String(
      m.from?.id ??
      m.chat.id
    );

  const chatId =
    String(m.chat.id);

  if (m.media_group_id) {
    return handleMediaGroupItem(
      m,
      userId,
      chatId,
      env
    );
  }

  const resource =
    extractSingleMediaResource(m);

  if (!resource) {
    return;
  }

  const state =
    await getState(
      userId,
      env
    );

  if (
    state?.startsWith(
      "move_to:"
    )
  ) {
    const folderId =
      Number(
        state.slice(
          "move_to:".length
        )
      );

    await clearState(
      userId,
      env
    );

    return finishSave(
      userId,
      chatId,
      resource,
      folderId,
      env
    );
  }

  return acceptIncomingResource(
    userId,
    chatId,
    resource,
    env
  );
}


async function handleLinkMessage(
  m,
  env
) {
  const userId =
    String(
      m.from?.id ??
      m.chat.id
    );

  const chatId =
    String(m.chat.id);

  const text =
    String(
      m.text || ""
    ).trim();

  const url =
    extractFirstUrl(text);

  if (!url) {
    return;
  }

  const resource = {
    type: "link",
    url,
    text,
    messageId:
      m.message_id,
    createdAt:
      Date.now()
  };

  const state =
    await getState(
      userId,
      env
    );

  if (
    state?.startsWith(
      "move_to:"
    )
  ) {
    const folderId =
      Number(
        state.slice(
          "move_to:".length
        )
      );

    await clearState(
      userId,
      env
    );

    return finishSave(
      userId,
      chatId,
      resource,
      folderId,
      env
    );
  }

  return acceptIncomingResource(
    userId,
    chatId,
    resource,
    env
  );
}


// ============================================================
// Pending resource state machine
// ============================================================

async function acceptIncomingResource(
  userId,
  chatId,
  resource,
  env
) {
  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const state =
      await getStateRecord(
        userId,
        env
      );

    if (
      state?.state ===
      "auto_archiving"
    ) {
      await sleep(30);
      continue;
    }

    if (
      state?.state?.startsWith(
        "pending_resource:"
      )
    ) {
      const old =
        parsePendingResource(
          state.state
        );

      if (!old) {
        await clearState(
          userId,
          env
        );

        continue;
      }

      if (!state.last_folder_id) {
        await sendMessage(
          chatId,
          "主人，还有一个资源正在等待整理，请先选择它的文件夹。",
          {},
          env
        );

        return;
      }

      const claimed =
        await claimPending(
          userId,
          state.state,
          env
        );

      if (!claimed) {
        continue;
      }

      try {
        await saveAndReplacePending(
          userId,
          chatId,
          old,
          Number(
            state.last_folder_id
          ),
          resource,
          env
        );

        return;
      } catch (e) {
        console.error(
          "AUTO ARCHIVE ERROR",
          e?.stack || e
        );

        await setPendingResource(
          userId,
          old,
          env
        );

        await sendMessage(
          chatId,
          "自动归档上一个资源时失败了，我暂时保留原资源。",
          {},
          env
        );

        return;
      }
    }

    await setPendingResource(
      userId,
      resource,
      env
    );

    return chooseFolderForUpload(
      userId,
      chatId,
      env
    );
  }

  return sendMessage(
    chatId,
    "正在处理上一条资源，请稍后再发送。",
    {},
    env
  );
}


async function saveAndReplacePending(
  userId,
  chatId,
  oldResource,
  oldFolderId,
  newResource,
  env
) {
  const oldPrepared =
    await prepareSave(
      userId,
      oldResource,
      oldFolderId,
      env
    );

  const newState =
    pendingState(
      newResource
    );

  await env.DB.batch([
    oldPrepared.statement,

    env.DB.prepare(`
      UPDATE user_states
      SET
        state = ?,
        last_folder_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
        AND state = ?
    `).bind(
      newState,
      oldFolderId,
      userId,
      "auto_archiving"
    )
  ]);

  await sendSavedMessage(
    chatId,
    oldPrepared.result,
    env
  );

  return chooseFolderForUpload(
    userId,
    chatId,
    env
  );
}


async function finishSave(
  userId,
  chatId,
  resource,
  folderId,
  env
) {
  try {
    const before =
      await getStateRecord(
        userId,
        env
      );

    const prepared =
      await prepareSave(
        userId,
        resource,
        folderId,
        env
      );

    await env.DB.batch([
      prepared.statement,

      env.DB.prepare(`
        INSERT INTO user_states(
          chat_id,
          state,
          last_folder_id,
          progress_message_id,
          batch_done,
          batch_total,
          updated_at
        )
        VALUES(
          ?,
          '',
          ?,
          NULL,
          0,
          0,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT(chat_id)
        DO UPDATE SET
          state = '',
          last_folder_id = excluded.last_folder_id,
          progress_message_id = NULL,
          batch_done = 0,
          batch_total = 0,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        userId,
        folderId
      )
    ]);

    if (
      before?.progress_message_id
    ) {
      await editMessage(
        chatId,
        before.progress_message_id,
        formatSavedText(
          prepared.result
        ),
        {
          reply_markup:
            fileResultKeyboard(
              prepared.result
            )
        },
        env
      );
    } else {
      await sendSavedMessage(
        chatId,
        prepared.result,
        env
      );
    }
  } catch (e) {
    console.error(
      "SAVE ERROR",
      e?.stack || e
    );

    await setPendingResource(
      userId,
      resource,
      env
    );

    if (
      e?.code === "DUPLICATE"
    ) {
      return sendMessage(
        chatId,
        `⚠️ <b>这个资源已经存在</b>\n\n` +
          `没有再次创建索引。\n` +
          `Telegram 文件本身没有被删除。`,
        {},
        env
      );
    }

    return sendMessage(
      chatId,
      "主人，保存失败了。\n\n" +
        "我保留了这个资源，请重新选择文件夹。",
      {},
      env
    );
  }
}


// ============================================================
// Pending encoding
// ============================================================

function pendingState(resource) {
  if (!resource._pendingToken) {
    resource._pendingToken =
      crypto.randomUUID();
  }

  return (
    "pending_resource:" +
    encodeURIComponent(
      JSON.stringify(resource)
    )
  );
}


function parsePendingResource(
  state
) {
  try {
    return JSON.parse(
      decodeURIComponent(
        state.slice(
          "pending_resource:".length
        )
      )
    );
  } catch {
    return null;
  }
}


async function setPendingResource(
  userId,
  resource,
  env
) {
  await setState(
    userId,
    pendingState(resource),
    env
  );
}


async function claimPending(
  userId,
  oldState,
  env
) {
  const result =
    await env.DB.prepare(`
      UPDATE user_states
      SET
        state = 'auto_archiving',
        updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
        AND state = ?
    `).bind(
      userId,
      oldState
    ).run();

  return (
    Number(
      result.meta?.changes || 0
    ) === 1
  );
}


// ============================================================
// Media extraction
// ============================================================

function extractSingleMediaResource(m) {
  if (m.photo) {
    const x =
      m.photo.at(-1);

    return {
      type: "file",
      mediaKind: "photo",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        `图片_${m.message_id}.jpg`,

      fileSize:
        x.file_size || null,

      mimeType:
        "image/jpeg",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  if (m.document) {
    const x =
      m.document;

    return {
      type: "file",
      mediaKind: "document",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        x.file_name ||
        `文件_${m.message_id}`,

      fileSize:
        x.file_size || null,

      mimeType:
        x.mime_type ||
        "application/octet-stream",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  if (m.video) {
    const x =
      m.video;

    return {
      type: "file",
      mediaKind: "video",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        x.file_name ||
        `视频_${m.message_id}.mp4`,

      fileSize:
        x.file_size || null,

      mimeType:
        x.mime_type ||
        "video/mp4",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  if (m.animation) {
    const x =
      m.animation;

    return {
      type: "file",
      mediaKind: "animation",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        x.file_name ||
        `动画_${m.message_id}.mp4`,

      fileSize:
        x.file_size || null,

      mimeType:
        x.mime_type ||
        "video/mp4",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  if (m.audio) {
    const x =
      m.audio;

    return {
      type: "file",
      mediaKind: "audio",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        x.file_name ||
        x.title ||
        `音频_${m.message_id}`,

      fileSize:
        x.file_size || null,

      mimeType:
        x.mime_type ||
        "audio/mpeg",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  if (m.voice) {
    const x =
      m.voice;

    return {
      type: "file",
      mediaKind: "voice",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        `语音_${m.message_id}.ogg`,

      fileSize:
        x.file_size || null,

      mimeType:
        x.mime_type ||
        "audio/ogg",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  if (m.video_note) {
    const x =
      m.video_note;

    return {
      type: "file",
      mediaKind: "video_note",

      fileId:
        x.file_id,

      fileUniqueId:
        x.file_unique_id,

      fileName:
        `视频消息_${m.message_id}.mp4`,

      fileSize:
        x.file_size || null,

      mimeType:
        "video/mp4",

      caption:
        m.caption || "",

      messageId:
        m.message_id
    };
  }

  return null;
}


function extractMediaGroupItem(m) {
  const x =
    extractSingleMediaResource(m);

  if (!x) {
    return null;
  }

  return {
    kind:
      x.mediaKind,

    fileId:
      x.fileId,

    fileUniqueId:
      x.fileUniqueId,

    fileName:
      x.fileName,

    fileSize:
      x.fileSize,

    mimeType:
      x.mimeType,

    caption:
      x.caption,

    messageId:
      x.messageId
  };
}


// ============================================================
// Media group
// ============================================================

async function handleMediaGroupItem(
  m,
  userId,
  chatId,
  env
) {
  const item =
    extractMediaGroupItem(m);

  if (!item) {
    return;
  }

  const groupId =
    String(
      m.media_group_id
    );

  const state =
    await getStateRecord(
      userId,
      env
    );

  if (
    state?.state ===
    "auto_archiving"
  ) {
    await sleep(30);

    return handleMediaGroupItem(
      m,
      userId,
      chatId,
      env
    );
  }

  if (
    state?.state?.startsWith(
      "pending_resource:"
    )
  ) {
    const resource =
      parsePendingResource(
        state.state
      );

    if (
      resource?.type ===
        "media_group" &&
      String(
        resource.mediaGroupId
      ) === groupId
    ) {
      return appendMediaGroupItem(
        userId,
        state.state,
        resource,
        item,
        env
      );
    }

    if (
      resource &&
      state.last_folder_id
    ) {
      const claimed =
        await claimPending(
          userId,
          state.state,
          env
        );

      if (claimed) {
        return saveAndReplacePending(
          userId,
          chatId,
          resource,
          Number(
            state.last_folder_id
          ),
          makeMediaGroup(
            groupId,
            item
          ),
          env
        );
      }
    } else if (resource) {
      await sendMessage(
        chatId,
        "还有一个资源正在等待整理，请先选择文件夹。",
        {},
        env
      );

      return;
    }
  }

  const resource =
    makeMediaGroup(
      groupId,
      item
    );

  await setPendingResource(
    userId,
    resource,
    env
  );

  /*
   * 不立即把媒体组判定为完整。
   *
   * Telegram 的 album 是多个 update。
   * 后续 update 会继续 append。
   */
  await sleep(
    MEDIA_GROUP_WAIT
  );

  const latest =
    await getStateRecord(
      userId,
      env
    );

  if (
    latest?.state?.startsWith(
      "pending_resource:"
    )
  ) {
    const current =
      parsePendingResource(
        latest.state
      );

    if (
      current?.type ===
        "media_group" &&
      String(
        current.mediaGroupId
      ) === groupId
    ) {
      return chooseFolderForUpload(
        userId,
        chatId,
        env
      );
    }
  }
}


function makeMediaGroup(
  groupId,
  item
) {
  return {
    type: "media_group",

    mediaGroupId:
      groupId,

    items: [item],

    createdAt:
      Date.now()
  };
}


async function appendMediaGroupItem(
  userId,
  oldState,
  resource,
  item,
  env
) {
  /*
   * 媒体组内部：
   * 同一个 message_id 只允许出现一次。
   *
   * 不使用 file_unique_id 去重整个媒体组。
   * 因为同一个媒体可能合法地出现在不同位置。
   */
  if (
    resource.items.some(
      x =>
        String(x.messageId) ===
        String(item.messageId)
    )
  ) {
    return;
  }

  resource.items.push(item);

  resource.items.sort(
    (a, b) =>
      Number(a.messageId) -
      Number(b.messageId)
  );

  const next =
    pendingState(resource);

  const result =
    await env.DB.prepare(`
      UPDATE user_states
      SET
        state = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
        AND state = ?
    `).bind(
      next,
      userId,
      oldState
    ).run();

  if (
    Number(
      result.meta?.changes || 0
    ) === 1
  ) {
    return;
  }

  const latest =
    await getState(
      userId,
      env
    );

  if (
    latest?.startsWith(
      "pending_resource:"
    )
  ) {
    const latestResource =
      parsePendingResource(
        latest
      );

    if (
      latestResource
    ) {
      return appendMediaGroupItem(
        userId,
        latest,
        latestResource,
        item,
        env
      );
    }
  }
}


// ============================================================
// Upload folder picker
// ============================================================

async function chooseFolderForUpload(
  userId,
  chatId,
  env
) {
  return showUploadFolders(
    userId,
    chatId,
    null,
    null,
    env
  );
}


async function showUploadFolders(
  userId,
  chatId,
  parentId,
  editMessageId,
  env
) {
  const folders =
    await queryFolders(
      userId,
      parentId,
      env
    );

  const buttons = [];

  for (const f of folders) {
    buttons.push([
      {
        text:
          `📥 ${truncate(
            f.name,
            24
          )}`,
        callback_data:
          `uploadhere:${f.id}`
      },
      {
        text: "📂",
        callback_data:
          `uploadbrowse:${f.id}`
      }
    ]);
  }

  if (
    parentId !== null
  ) {
    buttons.push([
      {
        text:
          "📥 保存到当前文件夹",
        callback_data:
          `uploadhere:${parentId}`
      }
    ]);

    const folder =
      await getFolder(
        userId,
        parentId,
        env
      );

    if (
      folder?.parent_id !== null
    ) {
      buttons.push([
        {
          text:
            "⬆️ 上一级",
          callback_data:
            `uploadbrowse:${folder.parent_id}`
        }
      ]);
    }
  }

  buttons.push([
    {
      text:
        "🏠 根目录",
      callback_data:
        "uploadbrowse:root"
    }
  ]);

  const text =
    parentId === null
      ? "📥 <b>选择保存位置</b>\n\n" +
        "选择文件夹即可归档这个资源。"
      : `📥 <b>选择保存位置</b>\n\n` +
        `当前：<code>${escapeHtml(
          await getFolderPath(
            userId,
            parentId,
            env
          )
        )}</code>`;

  const options = {
    reply_markup: {
      inline_keyboard:
        buttons
    }
  };

  if (editMessageId) {
    const result =
      await editMessage(
        chatId,
        editMessageId,
        text,
        options,
        env
      );

    if (
      !result.ok
    ) {
      return sendMessage(
        chatId,
        text,
        options,
        env
      );
    }

    return result;
  }

  return sendMessage(
    chatId,
    text,
    options,
    env
  );
}


// ============================================================
// Callback
// ============================================================

async function handleCallback(
  q,
  env
) {
  const userId =
    String(q.from.id);

  const chatId =
    String(
      q.message?.chat?.id
    );

  const messageId =
    q.message?.message_id;

  const data =
    String(
      q.data || ""
    );

  await answerCallback(
    q.id,
    "",
    false,
    env
  );

  // ----------------------------------------------------------
  // Home
  // ----------------------------------------------------------

  if (
    data === "home:recent"
  ) {
    return showRecentFiles(
      userId,
      chatId,
      0,
      env,
      messageId
    );
  }

  if (
    data === "home:folders"
  ) {
    return showFolderRoot(
      userId,
      chatId,
      0,
      env,
      messageId
    );
  }

  if (
    data === "home:search"
  ) {
    await setState(
      userId,
      "search",
      env
    );

    return editMessage(
      chatId,
      messageId,
      "🔎 <b>搜索资源</b>\n\n" +
        "请输入文件名、ID 或关键词。",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "🏠 返回首页",
                callback_data:
                  "home:back"
              }
            ]
          ]
        }
      },
      env
    );
  }

  if (
    data === "home:help"
  ) {
    return editMessage(
      chatId,
      messageId,
      `<b>${BOT_NAME} 文件管家</b>\n\n` +
        `直接发送文件即可归档。\n\n` +
        `📁 创建 游戏/FGO\n` +
        `📂 打开 游戏/FGO\n` +
        `🔎 搜索 FGO\n` +
        `📤 取出资源\n` +
        `🆔 修改 ID\n` +
        `📂 移动到其他文件夹`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "🏠 首页",
                callback_data:
                  "home:back"
              }
            ]
          ]
        }
      },
      env
    );
  }

  if (
    data === "home:back"
  ) {
    await clearState(
      userId,
      env
    );

    return editMessage(
      chatId,
      messageId,
      `<b>${BOT_NAME} 文件管家</b>\n\n` +
        `欢迎回来，主人。\n` +
        `选择一个功能开始管理文件库。`,
      {
        reply_markup:
          homeKeyboard()
      },
      env
    );
  }

  // ----------------------------------------------------------
  // Upload picker
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "uploadbrowse:"
    )
  ) {
    const raw =
      data.slice(
        "uploadbrowse:".length
      );

    const parentId =
      raw === "root"
        ? null
        : Number(raw);

    return showUploadFolders(
      userId,
      chatId,
      parentId,
      messageId,
      env
    );
  }

  if (
    data.startsWith(
      "uploadhere:"
    )
  ) {
    return handleUploadHere(
      userId,
      chatId,
      messageId,
      Number(
        data.slice(
          "uploadhere:".length
        )
      ),
      env
    );
  }

  // ----------------------------------------------------------
  // Folder navigation
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "folder:"
    )
  ) {
    const parts =
      data.split(":");

    const folderId =
      Number(parts[1]);

    const page =
      Number(parts[2] || 0);

    return showFolder(
      userId,
      chatId,
      folderId,
      page,
      env,
      messageId
    );
  }

  if (
    data ===
    "folderroot"
  ) {
    return showFolderRoot(
      userId,
      chatId,
      0,
      env,
      messageId
    );
  }

  // ----------------------------------------------------------
  // Recent
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "recent:"
    )
  ) {
    const page =
      Number(
        data.slice(
          "recent:".length
        )
      );

    return showRecentFiles(
      userId,
      chatId,
      page,
      env,
      messageId
    );
  }

  // ----------------------------------------------------------
  // File
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "file:"
    )
  ) {
    return showFile(
      userId,
      chatId,
      Number(
        data.slice(
          "file:".length
        )
      ),
      env,
      messageId
    );
  }

  if (
    data.startsWith(
      "prevfile:"
    )
  ) {
    return navigateFile(
      userId,
      chatId,
      Number(
        data.slice(
          "prevfile:".length
        )
      ),
      -1,
      env
    );
  }

  if (
    data.startsWith(
      "nextfile:"
    )
  ) {
    return navigateFile(
      userId,
      chatId,
      Number(
        data.slice(
          "nextfile:".length
        )
      ),
      1,
      env
    );
  }

  if (
    data.startsWith(
      "sendfile:"
    )
  ) {
    return resendFile(
      userId,
      chatId,
      Number(
        data.slice(
          "sendfile:".length
        )
      ),
      env
    );
  }

  // ----------------------------------------------------------
  // Custom ID
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "customid:"
    )
  ) {
    const id =
      Number(
        data.slice(
          "customid:".length
        )
      );

    await setState(
      userId,
      `rename_file:${id}`,
      env
    );

    return sendMessage(
      chatId,
      "主人想把它改成什么 ID？\n\n" +
        "例如：<code>FGO-攻略-001</code>",
      {},
      env
    );
  }

  // ----------------------------------------------------------
  // Delete
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "deletefile:"
    )
  ) {
    return confirmDelete(
      userId,
      chatId,
      messageId,
      Number(
        data.slice(
          "deletefile:".length
        )
      ),
      env
    );
  }

  if (
    data.startsWith(
      "delete_confirm:"
    )
  ) {
    return deleteFile(
      userId,
      chatId,
      Number(
        data.slice(
          "delete_confirm:".length
        )
      ),
      env
    );
  }

  if (
    data ===
    "delete_cancel"
  ) {
    return sendMessage(
      chatId,
      "删除操作已取消。",
      {},
      env
    );
  }

  // ----------------------------------------------------------
  // Move
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "move_start:"
    )
  ) {
    return startMove(
      userId,
      chatId,
      Number(
        data.slice(
          "move_start:".length
        )
      ),
      env
    );
  }

  if (
    data.startsWith(
      "move_browse:"
    )
  ) {
    const raw =
      data.slice(
        "move_browse:".length
      );

    const folderId =
      raw === "root"
        ? null
        : Number(raw);

    return showMoveFolders(
      userId,
      chatId,
      folderId,
      messageId,
      env
    );
  }

  if (
    data.startsWith(
      "move_here:"
    )
  ) {
    return moveHere(
      userId,
      chatId,
      data.slice(
        "move_here:".length
      ),
      env
    );
  }

  if (
    data ===
    "move_cancel"
  ) {
    await clearState(
      userId,
      env
    );

    return sendMessage(
      chatId,
      "移动操作已取消。",
      {},
      env
    );
  }

  // ----------------------------------------------------------
  // Search
  // ----------------------------------------------------------

  if (
    data.startsWith(
      "search:"
    )
  ) {
    const encoded =
      data.slice(
        "search:".length
      );

    const [keyword, page] =
      decodeURIComponent(
        encoded
      ).split("|");

    return searchFiles(
      userId,
      chatId,
      keyword,
      Number(page || 0),
      env,
      messageId
    );
  }

  if (
    data === "noop"
  ) {
    return;
  }
}


// ============================================================
// Upload
// ============================================================

async function handleUploadHere(
  userId,
  chatId,
  messageId,
  folderId,
  env
) {
  const folder =
    await getFolder(
      userId,
      folderId,
      env
    );

  if (!folder) {
    return sendMessage(
      chatId,
      "这个文件夹已经不存在了。",
      {},
      env
    );
  }

  const state =
    await getState(
      userId,
      env
    );

  const resource =
    state?.startsWith(
      "pending_resource:"
    )
      ? parsePendingResource(
          state
        )
      : null;

  if (!resource) {
    return sendMessage(
      chatId,
      "这个待整理资源已经处理过了，请重新发送。",
      {},
      env
    );
  }

  const claimed =
    await claimPending(
      userId,
      state,
      env
    );

  if (!claimed) {
    return sendMessage(
      chatId,
      "这个资源已经被另一条操作处理了。",
      {},
      env
    );
  }

  return finishSave(
    userId,
    chatId,
    resource,
    folderId,
    env
  );
}


// ============================================================
// Delete
// ============================================================

async function confirmDelete(
  userId,
  chatId,
  messageId,
  id,
  env
) {
  const f =
    await getFile(
      userId,
      id,
      env
    );

  if (!f) {
    return sendMessage(
      chatId,
      "这个资源已经不存在了。",
      {},
      env
    );
  }

  return editMessage(
    chatId,
    messageId,
    `🗑 <b>确认删除？</b>\n\n` +
      `${getResourceIcon(
        f.mime_type
      )} ${escapeHtml(
        f.file_name
      )}\n` +
      `🆔 <code>${escapeHtml(
        f.custom_id || ""
      )}</code>\n\n` +
      `这里只会删除文件库中的索引，` +
      `不会删除 Telegram 中的原文件。`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🗑 确认删除",
              callback_data:
                `delete_confirm:${id}`
            },
            {
              text:
                "取消",
              callback_data:
                "delete_cancel"
            }
          ]
        ]
      }
    },
    env
  );
}


async function deleteFile(
  userId,
  chatId,
  id,
  env
) {
  const result =
    await env.DB.prepare(`
      DELETE FROM files
      WHERE id = ?
        AND user_id = ?
    `).bind(
      id,
      userId
    ).run();

  if (
    Number(
      result.meta?.changes || 0
    ) !== 1
  ) {
    return sendMessage(
      chatId,
      "这个资源已经不存在了。",
      {},
      env
    );
  }

  return sendMessage(
    chatId,
    "🗑 已删除这个资源的索引。\n\n" +
      "Telegram 中的原文件不会受到影响。",
    {},
    env
  );
}


// ============================================================
// Save / Dedup
// ============================================================

async function saveResource(
  userId,
  resource,
  folderId,
  env
) {
  const prepared =
    await prepareSave(
      userId,
      resource,
      folderId,
      env
    );

  try {
    await env.DB.batch([
      prepared.statement
    ]);
  } catch (e) {
    if (
      isUniqueConstraintError(e)
    ) {
      const err =
        new Error(
          "DUPLICATE"
        );

      err.code =
        "DUPLICATE";

      throw err;
    }

    throw e;
  }

  return prepared.result;
}


async function prepareSave(
  userId,
  resource,
  folderId,
  env
) {
  const folder =
    await getFolder(
      userId,
      folderId,
      env
    );

  if (!folder) {
    throw new Error(
      "Folder not found"
    );
  }

  let fileId;
  let fileUniqueId;
  let fileName;
  let fileSize = null;
  let mimeType;

  let photoCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  let documentCount = 0;

  // ----------------------------------------------------------
  // Ordinary file
  // ----------------------------------------------------------

  if (
    resource.type ===
    "file"
  ) {
    fileName =
      deriveName(
        resource
      );

    fileSize =
      resource.fileSize ||
      null;

    mimeType =
      resource.mimeType ||
      "application/octet-stream";

    fileId =
      resource.fileId;

    fileUniqueId =
      buildFileDedupeKey(
        resource
      );

    if (!fileUniqueId) {
      throw new Error(
        "Missing Telegram file identity"
      );
    }
  }

  // ----------------------------------------------------------
  // Media group
  // ----------------------------------------------------------

  else if (
    resource.type ===
    "media_group"
  ) {
    const items =
      normalizeMediaGroupItems(
        resource.items
      );

    if (!items.length) {
      throw new Error(
        "Empty media group"
      );
    }

    resource.items =
      items;

    photoCount =
      items.filter(
        x =>
          x.kind === "photo"
      ).length;

    videoCount =
      items.filter(
        x =>
          x.kind === "video" ||
          x.kind === "animation" ||
          x.kind === "video_note"
      ).length;

    audioCount =
      items.filter(
        x =>
          x.kind === "audio" ||
          x.kind === "voice"
      ).length;

    documentCount =
      items.filter(
        x =>
          x.kind === "document"
      ).length;

    /*
     * 关键：
     *
     * 不再：
     *
     *   sort(fileUniqueId).join()
     *
     * 因为这会丢失媒体组的顺序。
     *
     * 也不使用 media_group_id，
     * 因为它只代表这一批消息，
     * 不能作为长期文件身份。
     */
    const identities =
      items.map(
        (x, index) =>
          `${index}:${mediaItemIdentity(x)}`
      );

    fileUniqueId =
      `album:v2:${identities.join("|")}`;

    fileId =
      JSON.stringify({
        type:
          "media_group",

        mediaGroupId:
          resource.mediaGroupId,

        items,

        createdAt:
          resource.createdAt ||
          Date.now()
      });

    fileName =
      deriveName(
        resource
      );

    mimeType =
      "media/media_group";

    fileSize =
      items.reduce(
        (sum, x) =>
          sum +
          Number(
            x.fileSize || 0
          ),
        0
      ) || null;
  }

  // ----------------------------------------------------------
  // Link
  // ----------------------------------------------------------

  else if (
    resource.type ===
    "link"
  ) {
    const normalized =
      normalizeUrl(
        resource.url
      );

    if (!normalized) {
      throw new Error(
        "Invalid URL"
      );
    }

    /*
     * 原代码：
     *
     * link:${messageId}
     *
     * 导致同一个 URL 每次发送
     * 都被认为是新资源。
     *
     * 现在使用规范化 URL。
     */
    fileUniqueId =
      `link:v2:${normalized}`;

    fileId =
      JSON.stringify({
        type: "link",
        url:
          resource.url,
        text:
          resource.text,
        messageId:
          resource.messageId
      });

    fileName =
      deriveName(
        resource
      );

    mimeType =
      "text/link";
  }

  else {
    throw new Error(
      "Unknown resource type"
    );
  }

  // ----------------------------------------------------------
  // Application-level duplicate check
  // ----------------------------------------------------------

  const duplicate =
    await findDuplicate(
      userId,
      resource,
      fileUniqueId,
      env
    );

  if (duplicate) {
    const e =
      new Error(
        "DUPLICATE"
      );

    e.code =
      "DUPLICATE";

    e.duplicateId =
      duplicate.id;

    throw e;
  }

  // ----------------------------------------------------------
  // Custom ID
  // ----------------------------------------------------------

  const customId =
    await generateCustomId(
      userId,
      folder.id,
      folder.name,
      env
    );

  const statement =
    env.DB.prepare(`
      INSERT INTO files(
        user_id,
        file_id,
        file_unique_id,
        file_name,
        file_size,
        mime_type,
        custom_id,
        folder_id
      )
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      userId,
      fileId,
      fileUniqueId,
      fileName,
      fileSize,
      mimeType,
      customId,
      folderId
    );

  return {
    statement,

    result: {
      type:
        resource.type,

      fileId,

      fileName,

      customId,

      folderId:

        folder.id,

      folderPath:
        await getFolderPath(
          userId,
          folder.id,
          env
        ),

      count:
        resource.items?.length ||
        null,

      photoCount,

      videoCount,

      audioCount,

      documentCount
    }
  };
}


// ============================================================
// Deduplication
// ============================================================

function buildFileDedupeKey(
  resource
) {
  const kind =
    resource.mediaKind ||
    inferMediaKind(
      resource.mimeType
    );

  const unique =
    cleanIdentity(
      resource.fileUniqueId
    );

  if (unique) {
    return (
      `tg:v2:${kind}:${unique}`
    );
  }

  /*
   * file_id 可以用于重新发送，
   * 但 Telegram 官方说明：
   * 同一文件可能有不同 file_id。
   *
   * 因此它只能作为缺少 file_unique_id
   * 时的 fallback。
   */
  const fileId =
    cleanIdentity(
      resource.fileId
    );

  if (fileId) {
    return (
      `tg:fileid:${kind}:${fileId}`
    );
  }

  /*
   * 最后 fallback 才使用 message_id。
   *
   * message_id 永远不是文件身份。
   */
  if (
    resource.messageId != null
  ) {
    return (
      `tg:message:${kind}:${resource.messageId}`
    );
  }

  return null;
}


function mediaItemIdentity(item) {
  const kind =
    item.kind ||
    inferMediaKind(
      item.mimeType
    );

  const unique =
    cleanIdentity(
      item.fileUniqueId
    );

  if (unique) {
    return `${kind}:${unique}`;
  }

  const fileId =
    cleanIdentity(
      item.fileId
    );

  if (fileId) {
    return `${kind}:fileid:${fileId}`;
  }

  return `${kind}:message:${item.messageId}`;
}


async function findDuplicate(
  userId,
  resource,
  key,
  env
) {
  if (!key) {
    return null;
  }

  const current =
    await env.DB.prepare(`
      SELECT
        id,
        custom_id,
        file_name,
        folder_id
      FROM files
      WHERE user_id = ?
        AND file_unique_id = ?
      LIMIT 1
    `).bind(
      userId,
      key
    ).first();

  if (current) {
    return current;
  }

  /*
   * 兼容旧版本数据库。
   *
   * 旧代码保存的是：
   *
   *   raw file_unique_id
   *
   * 新代码保存：
   *
   *   tg:v2:type:file_unique_id
   *
   * 因此第一次升级时，
   * 再尝试一次旧格式。
   */
  if (
    resource.type ===
    "file"
  ) {
    const raw =
      cleanIdentity(
        resource.fileUniqueId
      );

    if (raw) {
      const legacy =
        await env.DB.prepare(`
          SELECT
            id,
            custom_id,
            file_name,
            folder_id
          FROM files
          WHERE user_id = ?
            AND file_unique_id = ?
          LIMIT 1
        `).bind(
          userId,
          raw
        ).first();

      if (legacy) {
        return legacy;
      }
    }
  }

  return null;
}


function isUniqueConstraintError(e) {
  return /unique|constraint/i.test(
    String(
      e?.message || ""
    )
  );
}


// ============================================================
// Custom ID
// ============================================================

async function generateCustomId(
  userId,
  folderId,
  folderName,
  env
) {
  const prefix =
    cleanIdPrefix(
      folderName
    );

  const rows =
    (
      await env.DB.prepare(`
        SELECT custom_id
        FROM files
        WHERE user_id = ?
          AND folder_id = ?
      `).bind(
        userId,
        folderId
      ).all()
    ).results || [];

  let max = 0;

  const pattern =
    new RegExp(
      "^" +
        escapeRegExp(
          prefix
        ) +
        "-(\\d+)$"
    );

  for (const row of rows) {
    const match =
      String(
        row.custom_id || ""
      ).match(
        pattern
      );

    if (match) {
      max =
        Math.max(
          max,
          Number(
            match[1]
          )
        );
    }
  }

  return (
    `${prefix}-` +
    String(
      max + 1
    ).padStart(
      3,
      "0"
    )
  );
}


// ============================================================
// Save result UI
// ============================================================

function formatSavedText(result) {
  if (
    result.type ===
    "media_group"
  ) {
    return (
      `✅ <b>归档完成</b>\n\n` +
      `📦 <b>${escapeHtml(
        result.fileName
      )}</b>\n` +
      `媒体数量：${result.count}\n` +
      `📁 <code>${escapeHtml(
        result.folderPath
      )}</code>\n` +
      `🆔 <code>${escapeHtml(
        result.customId
      )}</code>`
    );
  }

  if (
    result.type ===
    "link"
  ) {
    return (
      `✅ <b>归档完成</b>\n\n` +
      `🔗 <b>${escapeHtml(
        result.fileName
      )}</b>\n` +
      `📁 <code>${escapeHtml(
        result.folderPath
      )}</code>\n` +
      `🆔 <code>${escapeHtml(
        result.customId
      )}</code>`
    );
  }

  return (
    `✅ <b>归档完成</b>\n\n` +
    `${getResourceIcon(
      result.mimeType
    )} <b>${escapeHtml(
      result.fileName
    )}</b>\n` +
    `📁 <code>${escapeHtml(
      result.folderPath
    )}</code>\n` +
    `🆔 <code>${escapeHtml(
      result.customId
    )}</code>`
  );
}


function fileResultKeyboard(result) {
  return {
    inline_keyboard: [
      [
        {
          text:
            "📂 查看文件夹",
          callback_data:
            `folder:${result.folderId}:0`
        }
      ]
    ]
  };
}


async function sendSavedMessage(
  chatId,
  result,
  env
) {
  return sendMessage(
    chatId,
    formatSavedText(
      result
    ),
    {
      reply_markup:
        fileResultKeyboard(
          result
        )
    },
    env
  );
}


// ============================================================
// Folder views
// ============================================================

async function queryFolders(
  userId,
  parentId,
  env
) {
  if (
    parentId === null
  ) {
    return (
      await env.DB.prepare(`
        SELECT
          id,
          name,
          parent_id
        FROM folders
        WHERE user_id = ?
          AND parent_id IS NULL
        ORDER BY name COLLATE NOCASE
      `).bind(
        userId
      ).all()
    ).results || [];
  }

  return (
    await env.DB.prepare(`
      SELECT
        id,
        name,
        parent_id
      FROM folders
      WHERE user_id = ?
        AND parent_id = ?
      ORDER BY name COLLATE NOCASE
    `).bind(
      userId,
      parentId
    ).all()
  ).results || [];
}


async function showFolderRoot(
  userId,
  chatId,
  page,
  env,
  editMessageId = null
) {
  const folders =
    await queryFolders(
      userId,
      null,
      env
    );

  const total =
    folders.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total /
          PAGE_SIZE
      )
    );

  const safePage =
    clampPage(
      page,
      totalPages
    );

  const start =
    safePage *
    PAGE_SIZE;

  const visible =
    folders.slice(
      start,
      start + PAGE_SIZE
    );

  const buttons =
    visible.map(
      f => [
        {
          text:
            `📁 ${truncate(
              f.name,
              28
            )}`,
          callback_data:
            `folder:${f.id}:0`
        }
      ]
    );

  const navigation =
    paginationButtons(
      "rootpage",
      safePage,
      totalPages
    );

  if (navigation.length) {
    buttons.push(
      navigation
    );
  }

  buttons.push([
    {
      text:
        "🏠 首页",
      callback_data:
        "home:back"
    }
  ]);

  const text =
    `📁 <b>文件夹</b>\n\n` +
    `根目录共有 ${total} 个文件夹。`;

  return renderMenu(
    chatId,
    editMessageId,
    text,
    {
      inline_keyboard:
        buttons
    },
    env
  );
}


async function showFolder(
  userId,
  chatId,
  folderId,
  page,
  env,
  editMessageId = null
) {
  const folder =
    await getFolder(
      userId,
      folderId,
      env
    );

  if (!folder) {
    return sendMessage(
      chatId,
      "这个文件夹已经不存在了。",
      {},
      env
    );
  }

  const subs =
    await queryFolders(
      userId,
      folderId,
      env
    );

  const files =
    (
      await env.DB.prepare(`
        SELECT
          id,
          file_name,
          custom_id,
          mime_type
        FROM files
        WHERE user_id = ?
          AND folder_id = ?
        ORDER BY created_at DESC, id DESC
      `).bind(
        userId,
        folderId
      ).all()
    ).results || [];

  const totalItems =
    subs.length +
    files.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalItems /
          PAGE_SIZE
      )
    );

  const safePage =
    clampPage(
      page,
      totalPages
    );

  const allItems = [
    ...subs.map(
      f => ({
        kind: "folder",
        data: f
      })
    ),

    ...files.map(
      f => ({
        kind: "file",
        data: f
      })
    )
  ];

  const visible =
    allItems.slice(
      safePage *
        PAGE_SIZE,
      safePage *
        PAGE_SIZE +
        PAGE_SIZE
    );

  const buttons =
    visible.map(
      item => {
        if (
          item.kind ===
          "folder"
        ) {
          return [
            {
              text:
                `📁 ${truncate(
                  item.data.name,
                  25
                )}`,
              callback_data:
                `folder:${item.data.id}:0`
            }
          ];
        }

        return [
          {
            text:
              `${getResourceIcon(
                item.data.mime_type
              )} ` +
              `${item.data.custom_id || "无ID"} · ` +
              `${truncate(
                item.data.file_name,
                20
              )}`,
            callback_data:
              `file:${item.data.id}`
          }
        ];
      }
    );

  const navigation =
    paginationButtons(
      `folderpage:${folderId}`,
      safePage,
      totalPages
    );

  if (navigation.length) {
    buttons.push(
      navigation
    );
  }

  if (
    folder.parent_id !== null
  ) {
    buttons.push([
      {
        text:
          "⬆️ 上一级",
        callback_data:
          `folder:${folder.parent_id}:0`
      }
    ]);
  } else {
    buttons.push([
      {
        text:
          "📁 根目录",
        callback_data:
          "folderroot"
      }
    ]);
  }

  buttons.push([
    {
      text:
        "🏠 首页",
      callback_data:
        "home:back"
    }
  ]);

  const path =
    await getFolderPath(
      userId,
      folderId,
      env
    );

  const text =
    `📁 <b>${escapeHtml(
      folder.name
    )}</b>\n\n` +
    `📍 <code>${escapeHtml(
      path
    )}</code>\n` +
    `📁 子文件夹：${subs.length}\n` +
    `📦 资源：${files.length}`;

  return renderMenu(
    chatId,
    editMessageId,
    text,
    {
      inline_keyboard:
        buttons
    },
    env
  );
}


async function showRecentFiles(
  userId,
  chatId,
  page,
  env,
  editMessageId = null
) {
  const rows =
    (
      await env.DB.prepare(`
        SELECT
          id,
          file_name,
          custom_id,
          mime_type
        FROM files
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
      `).bind(
        userId
      ).all()
    ).results || [];

  if (!rows.length) {
    return renderMenu(
      chatId,
      editMessageId,
      "📄 <b>最近资源</b>\n\n" +
        "主人，目前还没有资源。",
      {
        inline_keyboard: [
          [
            {
              text:
                "🏠 首页",
              callback_data:
                "home:back"
            }
          ]
        ]
      },
      env
    );
  }

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        rows.length /
          PAGE_SIZE
      )
    );

  const safePage =
    clampPage(
      page,
      totalPages
    );

  const visible =
    rows.slice(
      safePage *
        PAGE_SIZE,
      safePage *
        PAGE_SIZE +
        PAGE_SIZE
    );

  const buttons =
    visible.map(
      f => [
        {
          text:
            `${getResourceIcon(
              f.mime_type
            )} ` +
            `${f.custom_id || "无ID"} · ` +
            `${truncate(
              f.file_name,
              22
            )}`,
          callback_data:
            `file:${f.id}`
        }
      ]
    );

  const navigation =
    paginationButtons(
      "recent",
      safePage,
      totalPages
    );

  if (navigation.length) {
    buttons.push(
      navigation
    );
  }

  buttons.push([
    {
      text:
        "🏠 首页",
      callback_data:
        "home:back"
    }
  ]);

  return renderMenu(
    chatId,
    editMessageId,
    `📄 <b>最近资源</b>\n\n` +
      `共 ${rows.length} 个资源`,
    {
      inline_keyboard:
        buttons
    },
    env
  );
}


// ============================================================
// File detail
// ============================================================

async function showFile(
  userId,
  chatId,
  id,
  env,
  editMessageId = null
) {
  const file =
    await getFile(
      userId,
      id,
      env
    );

  if (!file) {
    return sendMessage(
      chatId,
      "这个资源已经不存在了。",
      {},
      env
    );
  }

  return renderFile(
    userId,
    chatId,
    file,
    env,
    editMessageId
  );
}


async function renderFile(
  userId,
  chatId,
  f,
  env,
  editMessageId = null
) {
  const path =
    f.folder_id
      ? await getFolderPath(
          userId,
          f.folder_id,
          env
        )
      : "根目录";

  const size =
    f.file_size
      ? formatFileSize(
          f.file_size
        )
      : "未知";

  const buttons = [
    [
      {
        text:
          "📤 取出资源",
        callback_data:
          `sendfile:${f.id}`
      }
    ],
    [
      {
        text:
          "🆔 修改 ID",
        callback_data:
          `customid:${f.id}`
      },
      {
        text:
          "📂 移动",
        callback_data:
          `move_start:${f.id}`
      }
    ],
    [
      {
        text:
          "🗑 删除",
        callback_data:
          `deletefile:${f.id}`
      }
    ]
  ];

  if (
    f.folder_id
  ) {
    buttons.push([
      {
        text:
          "⬅️ 返回文件夹",
        callback_data:
          `folder:${f.folder_id}:0`
      }
    ]);
  } else {
    buttons.push([
      {
        text:
          "📁 文件夹",
        callback_data:
          "folderroot"
      }
    ]);
  }

  buttons.push([
    {
      text:
        "🏠 首页",
      callback_data:
        "home:back"
    }
  ]);

  const text =
    `${getResourceIcon(
      f.mime_type
    )} <b>${escapeHtml(
      f.file_name
    )}</b>\n\n` +

    `🆔 ID：<code>${escapeHtml(
      f.custom_id || "无"
    )}</code>\n` +

    `📁 路径：<code>${escapeHtml(
      path
    )}</code>\n` +

    `📦 大小：${size}\n` +

    `🗂 类型：<code>${escapeHtml(
      f.mime_type ||
      "未知"
    )}</code>`;

  return renderMenu(
    chatId,
    editMessageId,
    text,
    {
      inline_keyboard:
        buttons
    },
    env
  );
}


// ============================================================
// Navigation
// ============================================================

async function navigateFile(
  userId,
  chatId,
  currentId,
  direction,
  env
) {
  const current =
    await getFile(
      userId,
      currentId,
      env
    );

  if (!current) {
    return sendMessage(
      chatId,
      "这个资源已经不存在了。",
      {},
      env
    );
  }

  const adjacent =
    await adjacentFile(
      userId,
      current.custom_id,
      direction,
      env
    );

  if (!adjacent) {
    return sendMessage(
      chatId,
      direction < 0
        ? "已经是第一项了。"
        : "已经是最后一项了。",
      {},
      env
    );
  }

  return resendFile(
    userId,
    chatId,
    adjacent.id,
    env
  );
}


async function adjacentFile(
  userId,
  customId,
  direction,
  env
) {
  if (!customId) {
    return null;
  }

  const operator =
    direction < 0
      ? "<"
      : ">";

  const order =
    direction < 0
      ? "DESC"
      : "ASC";

  return env.DB.prepare(`
    SELECT
      id,
      custom_id
    FROM files
    WHERE user_id = ?
      AND custom_id ${operator} ?
    ORDER BY custom_id ${order}, id ${order}
    LIMIT 1
  `).bind(
    userId,
    customId
  ).first();
}


// ============================================================
// Resend
// ============================================================

async function resendFile(
  userId,
  chatId,
  id,
  env
) {
  const f =
    await getFile(
      userId,
      id,
      env
    );

  if (!f) {
    return sendMessage(
      chatId,
      "这个资源已经不存在了。",
      {},
      env
    );
  }

  if (
    f.mime_type ===
    "media/media_group"
  ) {
    return resendMediaGroup(
      userId,
      chatId,
      f,
      env
    );
  }

  if (
    f.mime_type ===
    "text/link"
  ) {
    return resendLink(
      userId,
      chatId,
      f,
      env
    );
  }

  const prev =
    await adjacentFile(
      userId,
      f.custom_id,
      -1,
      env
    );

  const next =
    await adjacentFile(
      userId,
      f.custom_id,
      1,
      env
    );

  const replyMarkup =
    buildFileNavigationButtons(
      f.id,
      prev,
      next
    );

  const caption =
    `🆔 ${f.custom_id || ""}\n` +
    `📄 ${f.file_name}`;

  let method =
    "sendDocument";

  let body = {
    chat_id:
      chatId,

    document:
      f.file_id,

    caption
  };

  if (
    f.mime_type?.startsWith(
      "image/"
    )
  ) {
    method =
      "sendPhoto";

    body = {
      chat_id:
        chatId,

      photo:
        f.file_id,

      caption
    };
  } else if (
    f.mime_type?.startsWith(
      "video/"
    )
  ) {
    method =
      "sendVideo";

    body = {
      chat_id:
        chatId,

      video:
        f.file_id,

      caption
    };
  } else if (
    f.mime_type?.startsWith(
      "audio/"
    )
  ) {
    method =
      "sendAudio";

    body = {
      chat_id:
        chatId,

      audio:
        f.file_id,

      caption
    };
  } else if (
    f.mime_type ===
    "audio/ogg"
  ) {
    method =
      "sendVoice";

    body = {
      chat_id:
        chatId,

      voice:
        f.file_id,

      caption
    };
  }

  if (replyMarkup) {
    body.reply_markup =
      replyMarkup;
  }

  return telegram(
    method,
    body,
    env
  );
}


function buildFileNavigationButtons(
  currentId,
  prev,
  next
) {
  if (!prev && !next) {
    return null;
  }

  return {
    inline_keyboard: [
      [
        {
          text:
            "⬅️ 上一个",
          callback_data:
            prev
              ? `prevfile:${currentId}`
              : "noop"
        },
        {
          text:
            "➡️ 下一个",
          callback_data:
            next
              ? `nextfile:${currentId}`
              : "noop"
        }
      ]
    ]
  };
}


async function resendMediaGroup(
  userId,
  chatId,
  f,
  env
) {
  let data;

  try {
    data =
      JSON.parse(
        f.file_id
      );
  } catch {
    return sendMessage(
      chatId,
      "媒体组数据损坏。",
      {},
      env
    );
  }

  const media =
    (data.items || [])
      .map(
        x => {
          let type =
            "document";

          if (
            x.kind ===
            "photo"
          ) {
            type =
              "photo";
          } else if (
            x.kind ===
              "video" ||
            x.kind ===
              "animation"
          ) {
            type =
              "video";
          } else if (
            x.kind ===
              "audio"
          ) {
            type =
              "audio";
          }

          const item = {
            type,
            media:
              x.fileId
          };

          if (x.caption) {
            item.caption =
              x.caption;
          }

          return item;
        }
      );

  if (!media.length) {
    return sendMessage(
      chatId,
      "这个媒体组没有可取出的内容。",
      {},
      env
    );
  }

  const result =
    await telegram(
      "sendMediaGroup",
      {
        chat_id:
          chatId,

        media
      },
      env
    );

  if (!result?.ok) {
    return result;
  }

  const prev =
    await adjacentFile(
      userId,
      f.custom_id,
      -1,
      env
    );

  const next =
    await adjacentFile(
      userId,
      f.custom_id,
      1,
      env
    );

  const replyMarkup =
    buildFileNavigationButtons(
      f.id,
      prev,
      next
    );

  if (replyMarkup) {
    await sendMessage(
      chatId,
      `📦 <b>${escapeHtml(
        f.file_name
      )}</b>\n` +
        `🆔 <code>${escapeHtml(
          f.custom_id || ""
        )}</code>`,
      {
        reply_markup:
          replyMarkup
      },
      env
    );
  }

  return result;
}


async function resendLink(
  userId,
  chatId,
  f,
  env
) {
  const prev =
    await adjacentFile(
      userId,
      f.custom_id,
      -1,
      env
    );

  const next =
    await adjacentFile(
      userId,
      f.custom_id,
      1,
      env
    );

  const replyMarkup =
    buildFileNavigationButtons(
      f.id,
      prev,
      next
    );

  let x;

  try {
    x =
      JSON.parse(
        f.file_id
      );
  } catch {
    x = {
      text:
        f.file_name,
      url:
        ""
    };
  }

  return sendMessage(
    chatId,
    x.text ||
      x.url ||
      f.file_name,
    {
      disable_web_page_preview:
        false,

      ...(replyMarkup
        ? {
            reply_markup:
              replyMarkup
          }
        : {})
    },
    env
  );
}


// ============================================================
// Move
// ============================================================

async function startMove(
  userId,
  chatId,
  fileId,
  env
) {
  const file =
    await getFile(
      userId,
      fileId,
      env
    );

  if (!file) {
    return sendMessage(
      chatId,
      "这个资源不存在。",
      {},
      env
    );
  }

  await setState(
    userId,
    `moving:${fileId}`,
    env
  );

  return showMoveFolders(
    userId,
    chatId,
    null,
    null,
    env
  );
}


async function showMoveFolders(
  userId,
  chatId,
  parentId,
  editMessageId,
  env
) {
  const folders =
    await queryFolders(
      userId,
      parentId,
      env
    );

  const buttons = [];

  for (const f of folders) {
    buttons.push([
      {
        text:
          `📥 ${truncate(
            f.name,
            25
          )}`,
        callback_data:
          `move_here:${f.id}`
      },
      {
        text:
          "📂",
        callback_data:
          `move_browse:${f.id}`
      }
    ]);
  }

  if (
    parentId !== null
  ) {
    const f =
      await getFolder(
        userId,
        parentId,
        env
      );

    buttons.push([
      {
        text:
          "📥 移到这里",
        callback_data:
          `move_here:${parentId}`
      }
    ]);

    if (
      f?.parent_id !== null
    ) {
      buttons.push([
        {
          text:
            "⬆️ 上一级",
          callback_data:
            `move_browse:${f.parent_id}`
        }
      ]);
    }
  }

  buttons.push([
    {
      text:
        "🏠 根目录",
      callback_data:
        "move_browse:root"
    },
    {
      text:
        "取消",
      callback_data:
        "move_cancel"
    }
  ]);

  const text =
    parentId === null
      ? "📂 <b>选择目标文件夹</b>"
      : `📂 <b>移动到</b>\n\n` +
        `当前：<code>${escapeHtml(
          await getFolderPath(
            userId,
            parentId,
            env
          )
        )}</code>`;

  return renderMenu(
    chatId,
    editMessageId,
    text,
    {
      inline_keyboard:
        buttons
    },
    env
  );
}


async function moveHere(
  userId,
  chatId,
  target,
  env
) {
  const state =
    await getState(
      userId,
      env
    );

  if (
    !state?.startsWith(
      "moving:"
    )
  ) {
    return sendMessage(
      chatId,
      "移动操作已经失效，请重新选择。",
      {},
      env
    );
  }

  const fileId =
    Number(
      state.slice(
        "moving:".length
      )
    );

  const folderId =
    target === "root"
      ? null
      : Number(target);

  if (
    folderId !== null
  ) {
    const folder =
      await getFolder(
        userId,
        folderId,
        env
      );

    if (!folder) {
      return sendMessage(
        chatId,
        "这个文件夹已经不存在了。",
        {},
        env
      );
    }
  }

  const result =
    await env.DB.prepare(`
      UPDATE files
      SET folder_id = ?
      WHERE id = ?
        AND user_id = ?
    `).bind(
      folderId,
      fileId,
      userId
    ).run();

  if (
    Number(
      result.meta?.changes || 0
    ) !== 1
  ) {
    return sendMessage(
      chatId,
      "移动失败，这个资源可能已经不存在了。",
      {},
      env
    );
  }

  await clearState(
    userId,
    env
  );

  const file =
    await getFile(
      userId,
      fileId,
      env
    );

  const path =
    folderId === null
      ? "根目录"
      : await getFolderPath(
          userId,
          folderId,
          env
        );

  return sendMessage(
    chatId,
    `✅ <b>移动完成</b>\n\n` +
      `${getResourceIcon(
        file?.mime_type
      )} ${escapeHtml(
        file?.file_name ||
        "资源"
      )}\n` +
      `📁 <code>${escapeHtml(
        path
      )}</code>`,
    {},
    env
  );
}


// ============================================================
// Inline mode
// ============================================================

async function handleInlineQuery(
  q,
  env
) {
  const userId =
    String(q.from.id);

  if (
    userId !== OWNER_ID
  ) {
    return telegram(
      "answerInlineQuery",
      {
        inline_query_id:
          q.id,

        results: [],

        cache_time: 0,

        is_personal:
          true
      },
      env
    );
  }

  const term =
    String(
      q.query || ""
    ).trim();

  const pattern =
    `%${term}%`;

  const rows =
    (
      await env.DB.prepare(`
        SELECT
          id,
          file_id,
          file_name,
          custom_id,
          file_size,
          mime_type,
          folder_id
        FROM files
        WHERE user_id = ?
          AND (
            ? = ''
            OR file_name LIKE ?
            OR custom_id LIKE ?
          )
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(
        userId,
        term,
        pattern,
        pattern,
        MAX_INLINE
      ).all()
    ).results || [];

  return telegram(
    "answerInlineQuery",
    {
      inline_query_id:
        q.id,

      results:
        rows.map(
          inlineResult
        ),

      cache_time:
        0,

      is_personal:
        true
    },
    env
  );
}


function inlineResult(f) {
  const title =
    `${f.custom_id || "无ID"} · ${f.file_name}`;

  const caption =
    `🆔 ${f.custom_id || ""}\n` +
    `📄 ${f.file_name}`;

  if (
    f.mime_type?.startsWith(
      "image/"
    )
  ) {
    return {
      type:
        "photo",

      id:
        String(f.id),

      photo_file_id:
        f.file_id,

      title,

      caption
    };
  }

  if (
    f.mime_type?.startsWith(
      "video/"
    )
  ) {
    return {
      type:
        "video",

      id:
        String(f.id),

      video_file_id:
        f.file_id,

      title,

      mime_type:
        f.mime_type,

      caption
    };
  }

  if (
    f.mime_type?.startsWith(
      "audio/"
    )
  ) {
    return {
      type:
        "audio",

      id:
        String(f.id),

      audio_file_id:
        f.file_id,

      title,

      caption
    };
  }

  if (
    f.mime_type !==
      "media/media_group" &&
    f.mime_type !==
      "text/link"
  ) {
    return {
      type:
        "document",

      id:
        String(f.id),

      document_file_id:
        f.file_id,

      title,

      caption
    };
  }

  if (
    f.mime_type ===
    "text/link"
  ) {
    let x = {};

    try {
      x =
        JSON.parse(
          f.file_id
        );
    } catch {}

    return {
      type:
        "article",

      id:
        String(f.id),

      title,

      description:
        x.url ||
        f.file_name,

      input_message_content: {
        message_text:
          x.text ||
          x.url ||
          f.file_name
      }
    };
  }

  return {
    type:
      "article",

    id:
      String(f.id),

    title,

    description:
      "媒体组",

    input_message_content: {
      message_text:
        `📦 ${f.file_name}\n` +
        `🆔 ${f.custom_id || ""}`
    }
  };
}


// ============================================================
// Search
// ============================================================

async function searchFiles(
  userId,
  chatId,
  keyword,
  page,
  env,
  editMessageId = null
) {
  const clean =
    String(
      keyword || ""
    ).trim();

  const pattern =
    `%${clean}%`;

  const files =
    (
      await env.DB.prepare(`
        SELECT
          id,
          file_name,
          custom_id,
          mime_type
        FROM files
        WHERE user_id = ?
          AND (
            file_name LIKE ?
            OR custom_id LIKE ?
          )
        ORDER BY created_at DESC
        LIMIT 100
      `).bind(
        userId,
        pattern,
        pattern
      ).all()
    ).results || [];

  const folders =
    (
      await env.DB.prepare(`
        SELECT
          id,
          name
        FROM folders
        WHERE user_id = ?
          AND name LIKE ?
        ORDER BY name COLLATE NOCASE
        LIMIT 50
      `).bind(
        userId,
        pattern
      ).all()
    ).results || [];

  const all = [
    ...folders.map(
      f => ({
        kind:
          "folder",
        data:
          f
      })
    ),

    ...files.map(
      f => ({
        kind:
          "file",
        data:
          f
      })
    )
  ];

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        all.length /
          SEARCH_PAGE_SIZE
      )
    );

  const safePage =
    clampPage(
      page,
      totalPages
    );

  const visible =
    all.slice(
      safePage *
        SEARCH_PAGE_SIZE,
      safePage *
        SEARCH_PAGE_SIZE +
        SEARCH_PAGE_SIZE
    );

  const buttons =
    visible.map(
      item => {
        if (
          item.kind ===
          "folder"
        ) {
          return [
            {
              text:
                `📁 ${truncate(
                  item.data.name,
                  28
                )}`,
              callback_data:
                `folder:${item.data.id}:0`
            }
          ];
        }

        return [
          {
            text:
              `${getResourceIcon(
                item.data.mime_type
              )} ` +
              `${item.data.custom_id || "无ID"} · ` +
              `${truncate(
                item.data.file_name,
                20
              )}`,
            callback_data:
              `file:${item.data.id}`
          }
        ];
      }
    );

  if (
    totalPages > 1
  ) {
    buttons.push([
      {
        text:
          safePage > 0
            ? "⬅️"
            : "·",

        callback_data:
          safePage > 0
            ? `search:${encodeURIComponent(
                clean
              )}|${safePage - 1}`
            : "noop"
      },

      {
        text:
          `${safePage + 1}/${totalPages}`,

        callback_data:
          "noop"
      },

      {
        text:
          safePage <
          totalPages - 1
            ? "➡️"
            : "·",

        callback_data:
          safePage <
          totalPages - 1
            ? `search:${encodeURIComponent(
                clean
              )}|${safePage + 1}`
            : "noop"
      }
    ]);
  }

  buttons.push([
    {
      text:
        "🏠 首页",
      callback_data:
        "home:back"
    }
  ]);

  return renderMenu(
    chatId,
    editMessageId,
    `🔎 <b>搜索结果</b>\n\n` +
      `关键词：<code>${escapeHtml(
        clean
      )}</code>\n` +
      `找到 ${all.length} 个结果`,
    {
      inline_keyboard:
        buttons
    },
    env
  );
}


// ============================================================
// State
// ============================================================

async function handleState(
  m,
  state,
  env
) {
  const userId =
    String(
      m.from?.id ??
      m.chat.id
    );

  const chatId =
    String(
      m.chat.id
    );

  const text =
    String(
      m.text || ""
    ).trim();

  if (
    state.startsWith(
      "create_folder"
    )
  ) {
    const parent =
      state.includes(":")
        ? Number(
            state.slice(
              "create_folder:".length
            )
          )
        : null;

    await clearState(
      userId,
      env
    );

    const result =
      await createFolderFromPath(
        userId,
        text,
        env,
        parent
      );

    await sendMessage(
      chatId,
      result.message,
      {},
      env
    );

    return true;
  }

  if (
    state === "search"
  ) {
    await clearState(
      userId,
      env
    );

    await searchFiles(
      userId,
      chatId,
      text,
      0,
      env
    );

    return true;
  }

  if (
    state.startsWith(
      "rename_file:"
    )
  ) {
    const id =
      Number(
        state.slice(
          "rename_file:".length
        )
      );

    await clearState(
      userId,
      env
    );

    if (!text) {
      return true;
    }

    const exists =
      await env.DB.prepare(`
        SELECT id
        FROM files
        WHERE user_id = ?
          AND custom_id = ?
          AND id != ?
        LIMIT 1
      `).bind(
        userId,
        text,
        id
      ).first();

    if (exists) {
      return sendMessage(
        chatId,
        "这个 ID 已经被使用了。",
        {},
        env
      );
    }

    await env.DB.prepare(`
      UPDATE files
      SET custom_id = ?
      WHERE user_id = ?
        AND id = ?
    `).bind(
      text,
      userId,
      id
    ).run();

    return sendMessage(
      chatId,
      `✅ 新的文件 ID：<code>${escapeHtml(
        text
      )}</code>`,
      {},
      env
    );
  }

  return false;
}


// ============================================================
// Natural language
// ============================================================

async function parseNaturalLanguage(
  text,
  userId,
  chatId,
  env
) {
  let m =
    text.match(
      /^(?:创建|新建|建立)(?:一个|个)?\s*(?:文件夹)?\s*(.+)$/i
    );

  if (m) {
    const result =
      await createFolderFromPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    await sendMessage(
      chatId,
      result.message,
      {},
      env
    );

    return true;
  }

  m =
    text.match(
      /^(?:打开|进入|查看)\s*(?:文件夹)?\s*(.+)$/i
    );

  if (m) {
    const folder =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!folder) {
      await sendMessage(
        chatId,
        "没有找到这个文件夹。",
        {},
        env
      );

      return true;
    }

    return showFolder(
      userId,
      chatId,
      folder.id,
      0,
      env
    );
  }

  m =
    text.match(
      /^(?:搜索|查找|找一下|找找)\s*(.+)$/i
    );

  if (m) {
    return searchFiles(
      userId,
      chatId,
      m[1],
      0,
      env
    );
  }

  m =
    text.match(
      /^把(?:刚才的|刚才那个|这个|该)?\s*(?:文件|资源|媒体)?\s*(?:放到|移动到|存到)\s*(.+)$/i
    );

  if (m) {
    const folder =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!folder) {
      await sendMessage(
        chatId,
        "没有找到这个文件夹。",
        {},
        env
      );

      return true;
    }

    const pending =
      await getState(
        userId,
        env
      );

    if (
      pending?.startsWith(
        "pending_resource:"
      )
    ) {
      const resource =
        parsePendingResource(
          pending
        );

      if (
        !resource
      ) {
        return true;
      }

      const claimed =
        await claimPending(
          userId,
          pending,
          env
        );

      if (!claimed) {
        return sendMessage(
          chatId,
          "这个待处理资源正在被另一条操作处理。",
          {},
          env
        );
      }

      return finishSave(
        userId,
        chatId,
        resource,
        folder.id,
        env
      );
    }

    const latest =
      await env.DB.prepare(`
        SELECT *
        FROM files
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).bind(
        userId
      ).first();

    if (!latest) {
      await setState(
        userId,
        `move_to:${folder.id}`,
        env
      );

      return sendMessage(
        chatId,
        "把文件发给我，我会直接放进这个文件夹。",
        {},
        env
      );
    }

    await env.DB.prepare(`
      UPDATE files
      SET folder_id = ?
      WHERE user_id = ?
        AND id = ?
    `).bind(
      folder.id,
      userId,
      latest.id
    ).run();

    return sendMessage(
      chatId,
      `✅ 已移动\n\n` +
        `📄 <b>${escapeHtml(
          latest.file_name
        )}</b>\n` +
        `📁 <code>${escapeHtml(
          await getFolderPath(
            userId,
            folder.id,
            env
          )
        )}</code>`,
      {},
      env
    );
  }

  m =
    text.match(
      /^把\s*(.+?)\s*(?:改名为|重命名为)\s*(.+)$/i
    );

  if (m) {
    const folder =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!folder) {
      return sendMessage(
        chatId,
        "没有找到这个文件夹。",
        {},
        env
      );
    }

    const name =
      cleanNaturalPath(
        m[2]
      )
        .split("/")
        .pop();

    const duplicate =
      await env.DB.prepare(`
        SELECT id
        FROM folders
        WHERE user_id = ?
          AND name = ?
          AND (
            parent_id = ?
            OR (
              parent_id IS NULL
              AND ? IS NULL
            )
          )
          AND id != ?
        LIMIT 1
      `).bind(
        userId,
        name,
        folder.parent_id,
        folder.parent_id,
        folder.id
      ).first();

    if (duplicate) {
      return sendMessage(
        chatId,
        "同一级目录已经有这个文件夹了。",
        {},
        env
      );
    }

    await env.DB.prepare(`
      UPDATE folders
      SET name = ?
      WHERE user_id = ?
        AND id = ?
    `).bind(
      name,
      userId,
      folder.id
    ).run();

    return sendMessage(
      chatId,
      `✅ 已改名为：<b>${escapeHtml(
        name
      )}</b>`,
      {},
      env
    );
  }

  m =
    text.match(
      /^(?:删除|删掉|移除)\s*(?:文件夹)?\s*(.+)$/i
    );

  if (m) {
    const folder =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!folder) {
      return sendMessage(
        chatId,
        "没有找到这个文件夹。",
        {},
        env
      );
    }

    const child =
      await env.DB.prepare(`
        SELECT id
        FROM folders
        WHERE user_id = ?
          AND parent_id = ?
        LIMIT 1
      `).bind(
        userId,
        folder.id
      ).first();

    const file =
      await env.DB.prepare(`
        SELECT id
        FROM files
        WHERE user_id = ?
          AND folder_id = ?
        LIMIT 1
      `).bind(
        userId,
        folder.id
      ).first();

    if (
      child ||
      file
    ) {
      return sendMessage(
        chatId,
        "这个文件夹里面还有内容，请先清空。",
        {},
        env
      );
    }

    await env.DB.prepare(`
      DELETE FROM folders
      WHERE user_id = ?
        AND id = ?
    `).bind(
      userId,
      folder.id
    ).run();

    return sendMessage(
      chatId,
      `🗑 已删除：<code>${escapeHtml(
        cleanNaturalPath(
          m[1]
        )
      )}</code>`,
      {},
      env
    );
  }

  return false;
}


// ============================================================
// Folder creation
// ============================================================

async function createFolderFromPath(
  userId,
  input,
  env,
  startParentId = null
) {
  const parts =
    cleanNaturalPath(
      input
    )
      .split("/")
      .filter(Boolean);

  if (!parts.length) {
    return {
      message:
        "主人没有告诉我要创建什么文件夹。"
    };
  }

  let parent =
    startParentId;

  const created = [];

  for (const name of parts) {
    let folder;

    if (
      parent === null
    ) {
      folder =
        await env.DB.prepare(`
          SELECT
            id,
            name,
            parent_id
          FROM folders
          WHERE user_id = ?
            AND name = ?
            AND parent_id IS NULL
          LIMIT 1
        `).bind(
          userId,
          name
        ).first();
    } else {
      folder =
        await env.DB.prepare(`
          SELECT
            id,
            name,
            parent_id
          FROM folders
          WHERE user_id = ?
            AND name = ?
            AND parent_id = ?
          LIMIT 1
        `).bind(
          userId,
          name,
          parent
        ).first();
    }

    if (!folder) {
      const result =
        await env.DB.prepare(`
          INSERT INTO folders(
            user_id,
            name,
            parent_id
          )
          VALUES(?,?,?)
        `).bind(
          userId,
          name,
          parent
        ).run();

      parent =
        result.meta.last_row_id;

      created.push(
        name
      );
    } else {
      parent =
        folder.id;
    }
  }

  return {
    message:
      created.length
        ? `好的，主人。\n\n` +
          `📁 已创建：<code>${escapeHtml(
            parts.join("/")
          )}</code>`
        : `这个文件夹已经存在：<code>${escapeHtml(
            parts.join("/")
          )}</code>`
  };
}


async function findFolderByPath(
  userId,
  input,
  env
) {
  const parts =
    cleanNaturalPath(
      input
    )
      .split("/")
      .filter(Boolean);

  let parent = null;
  let folder = null;

  for (
    const name of parts
  ) {
    if (
      parent === null
    ) {
      folder =
        await env.DB.prepare(`
          SELECT
            id,
            name,
            parent_id
          FROM folders
          WHERE user_id = ?
            AND name = ?
            AND parent_id IS NULL
          LIMIT 1
        `).bind(
          userId,
          name
        ).first();
    } else {
      folder =
        await env.DB.prepare(`
          SELECT
            id,
            name,
            parent_id
          FROM folders
          WHERE user_id = ?
            AND name = ?
            AND parent_id = ?
          LIMIT 1
        `).bind(
          userId,
          name,
          parent
        ).first();
    }

    if (!folder) {
      return null;
    }

    parent =
      folder.id;
  }

  return folder;
}


// ============================================================
// DB helpers
// ============================================================

async function getFile(
  userId,
  id,
  env
) {
  return env.DB.prepare(`
    SELECT *
    FROM files
    WHERE user_id = ?
      AND id = ?
    LIMIT 1
  `).bind(
    userId,
    id
  ).first();
}


async function getFolder(
  userId,
  id,
  env
) {
  return env.DB.prepare(`
    SELECT
      id,
      name,
      parent_id,
      created_at
    FROM folders
    WHERE user_id = ?
      AND id = ?
    LIMIT 1
  `).bind(
    userId,
    id
  ).first();
}


async function getFolderPath(
  userId,
  id,
  env
) {
  const result = [];

  let current =
    id;

  for (
    let i = 0;
    current !== null &&
    current !== undefined &&
    i < 100;
    i++
  ) {
    const folder =
      await getFolder(
        userId,
        current,
        env
      );

    if (!folder) {
      break;
    }

    result.unshift(
      folder.name
    );

    current =
      folder.parent_id;
  }

  return result.join("/");
}


// ============================================================
// State DB
// ============================================================

async function getStateRecord(
  userId,
  env
) {
  return env.DB.prepare(`
    SELECT
      state,
      last_folder_id,
      progress_message_id,
      batch_done,
      batch_total
    FROM user_states
    WHERE chat_id = ?
    LIMIT 1
  `).bind(
    userId
  ).first();
}


async function getState(
  userId,
  env
) {
  const row =
    await getStateRecord(
      userId,
      env
    );

  return row?.state || null;
}


async function setState(
  userId,
  state,
  env
) {
  await env.DB.prepare(`
    INSERT INTO user_states(
      chat_id,
      state,
      updated_at
    )
    VALUES(
      ?,
      ?,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(chat_id)
    DO UPDATE SET
      state = excluded.state,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    userId,
    state
  ).run();
}


async function clearState(
  userId,
  env
) {
  await env.DB.prepare(`
    UPDATE user_states
    SET
      state = '',
      progress_message_id = NULL,
      batch_done = 0,
      batch_total = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE chat_id = ?
  `).bind(
    userId
  ).run();
}


async function setLastFolder(
  userId,
  folderId,
  env
) {
  await env.DB.prepare(`
    INSERT INTO user_states(
      chat_id,
      last_folder_id,
      updated_at
    )
    VALUES(
      ?,
      ?,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(chat_id)
    DO UPDATE SET
      last_folder_id =
        excluded.last_folder_id,
      updated_at =
        CURRENT_TIMESTAMP
  `).bind(
    userId,
    folderId
  ).run();
}


// ============================================================
// UI helpers
// ============================================================

async function renderMenu(
  chatId,
  messageId,
  text,
  replyMarkup,
  env
) {
  if (messageId) {
    const result =
      await editMessage(
        chatId,
        messageId,
        text,
        {
          reply_markup:
            replyMarkup
        },
        env
      );

    if (result?.ok) {
      return result;
    }
  }

  return sendMessage(
    chatId,
    text,
    {
      reply_markup:
        replyMarkup
    },
    env
  );
}


function paginationButtons(
  prefix,
  page,
  totalPages
) {
  if (
    totalPages <= 1
  ) {
    return [];
  }

  let previous =
    "noop";

  let next =
    "noop";

  if (
    page > 0
  ) {
    if (
      prefix === "recent"
    ) {
      previous =
        `recent:${page - 1}`;
    } else if (
      prefix === "rootpage"
    ) {
      previous =
        "folderroot";
    } else if (
      prefix.startsWith(
        "folderpage:"
      )
    ) {
      const id =
        prefix.slice(
          "folderpage:".length
        );

      previous =
        `folder:${id}:${page - 1}`;
    }
  }

  if (
    page <
    totalPages - 1
  ) {
    if (
      prefix === "recent"
    ) {
      next =
        `recent:${page + 1}`;
    } else if (
      prefix.startsWith(
        "folderpage:"
      )
    ) {
      const id =
        prefix.slice(
          "folderpage:".length
        );

      next =
        `folder:${id}:${page + 1}`;
    } else if (
      prefix === "rootpage"
    ) {
      next =
        "folderroot";
    }
  }

  return [
    {
      text:
        page > 0
          ? "⬅️"
          : "·",
      callback_data:
        previous
    },
    {
      text:
        `${page + 1}/${totalPages}`,
      callback_data:
        "noop"
    },
    {
      text:
        page <
        totalPages - 1
          ? "➡️"
          : "·",
      callback_data:
        next
    }
  ];
}


// ============================================================
// Generic helpers
// ============================================================

function containsUrl(t) {
  return !!extractFirstUrl(t);
}


function extractFirstUrl(t) {
  const match =
    String(
      t || ""
    ).match(
      /(?:(?:https?:\/\/)|www\.)[^\s<>"']+/i
    );

  if (!match) {
    return null;
  }

  let url =
    match[0].replace(
      /[，。！？；：）》）】》"'、]+$/g,
      ""
    );

  if (
    url.startsWith(
      "www."
    )
  ) {
    url =
      "https://" +
      url;
  }

  return url;
}


function normalizeUrl(url) {
  try {
    const parsed =
      new URL(
        String(url)
          .trim()
      );

    parsed.hash = "";

    parsed.hostname =
      parsed.hostname
        .toLowerCase();

    /*
     * 默认端口不是 URL 身份的一部分。
     */
    if (
      (
        parsed.protocol ===
          "https:" &&
        parsed.port ===
          "443"
      ) ||
      (
        parsed.protocol ===
          "http:" &&
        parsed.port ===
          "80"
      )
    ) {
      parsed.port = "";
    }

    /*
     * 尾部 slash：
     *
     * example.com
     * example.com/
     *
     * 视为同一个 URL。
     */
    if (
      parsed.pathname === "/"
    ) {
      parsed.pathname = "";
    }

    return parsed.toString();
  } catch {
    return null;
  }
}


function getResourceIcon(
  mime
) {
  if (
    mime ===
    "media/media_group"
  ) {
    return "📦";
  }

  if (
    mime ===
    "text/link"
  ) {
    return "🔗";
  }

  if (
    mime?.startsWith(
      "image/"
    )
  ) {
    return "🖼";
  }

  if (
    mime?.startsWith(
      "video/"
    )
  ) {
    return "🎬";
  }

  if (
    mime?.startsWith(
      "audio/"
    )
  ) {
    return "🎵";
  }

  return "📄";
}


function inferMediaKind(
  mime
) {
  if (
    mime?.startsWith(
      "image/"
    )
  ) {
    return "photo";
  }

  if (
    mime?.startsWith(
      "video/"
    )
  ) {
    return "video";
  }

  if (
    mime?.startsWith(
      "audio/"
    )
  ) {
    return "audio";
  }

  return "document";
}


function normalizeMediaGroupItems(
  items
) {
  const result = [];
  const seenMessages =
    new Set();

  for (
    const item of
    items || []
  ) {
    const messageId =
      String(
        item.messageId
      );

    if (
      seenMessages.has(
        messageId
      )
    ) {
      continue;
    }

    seenMessages.add(
      messageId
    );

    result.push(
      item
    );
  }

  return result.sort(
    (a, b) =>
      Number(
        a.messageId
      ) -
      Number(
        b.messageId
      )
  );
}


function cleanIdentity(v) {
  const value =
    String(
      v ?? ""
    ).trim();

  return value || null;
}


function cleanNaturalPath(t) {
  return String(
    t || ""
  )
    .trim()
    .replace(
      /^['"“”‘’]+|['"“”‘’]+$/g,
      ""
    )
    .replace(
      /^文件夹[：:]\s*/i,
      ""
    )
    .replace(
      /\\/g,
      "/"
    )
    .replace(
      /\/+/g,
      "/"
    )
    .replace(
      /^\/|\/$/g,
      ""
    )
    .trim();
}


function truncate(
  t,
  n
) {
  const s =
    String(
      t || ""
    );

  return s.length <= n
    ? s
    : s.slice(
        0,
        n - 1
      ) + "…";
}


function clampPage(
  page,
  totalPages
) {
  const n =
    Number.isFinite(
      Number(page)
    )
      ? Number(page)
      : 0;

  return Math.max(
    0,
    Math.min(
      n,
      totalPages - 1
    )
  );
}


function formatFileSize(
  bytes
) {
  const b =
    Number(bytes);

  if (
    !Number.isFinite(b)
  ) {
    return "未知";
  }

  if (
    b < 1024
  ) {
    return `${b} B`;
  }

  if (
    b < 1048576
  ) {
    return `${(
      b / 1024
    ).toFixed(1)} KB`;
  }

  if (
    b < 1073741824
  ) {
    return `${(
      b / 1048576
    ).toFixed(1)} MB`;
  }

  return `${(
    b / 1073741824
  ).toFixed(2)} GB`;
}


function escapeHtml(t) {
  return String(
    t ?? ""
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


function escapeRegExp(t) {
  return String(t).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


function cleanIdPrefix(
  name
) {
  const prefix =
    String(
      name || ""
    )
      .trim()
      .replace(
        /\s+/g,
        "-"
      )
      .replace(
        /[^\w\u4e00-\u9fff-]/g,
        ""
      );

  return (
    prefix ||
    "FILE"
  ).slice(
    0,
    30
  );
}


function sanitizeName(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /[\\/:*?"<>|]/g,
      ""
    )
    .trim()
    .slice(
      0,
      80
    );
}


function deriveName(
  resource
) {
  let name = "";

  if (
    resource.type ===
    "link"
  ) {
    name =
      sanitizeName(
        resource.text
      )
        .replace(
          /https?:\/\/\S+/g,
          ""
        )
        .trim();

    if (!name) {
      try {
        name =
          new URL(
            resource.url
          ).hostname;
      } catch {}
    }
  }

  else if (
    resource.type ===
    "media_group"
  ) {
    const caption =
      resource.items
        ?.map(
          x =>
            sanitizeName(
              x.caption
            )
        )
        .find(Boolean);

    if (caption) {
      name =
        caption;
    } else {
      name =
        `媒体组_${resource.items?.length || 0}项`;
    }
  }

  else {
    name =
      sanitizeName(
        resource.caption
      );

    if (!name) {
      name =
        String(
          resource.fileName ||
          ""
        ).replace(
          /\.[a-z0-9]+$/i,
          ""
        );
    }
  }

  return (
    name ||
    (
      resource.type ===
      "link"
        ? "链接"
        : resource.type ===
          "media_group"
          ? "媒体组"
          : "文件"
    ) +
      "_" +
      Date.now()
  );
}


function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}
