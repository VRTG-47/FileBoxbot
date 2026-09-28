const OWNER_ID = "7559560220";

const BOT_NAME = "伊蕾希娅";

const MAX_INLINE = 20;

export default {
  async fetch(request, env) {
    try {
      if (request.method === "GET") {
        return new Response(`${BOT_NAME}在这里等候主人。`);
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405
        });
      }

      await handleUpdate(await request.json(), env);

      return new Response("OK");
    } catch (e) {
      console.error("WORKER ERROR", e?.stack || e);

      return new Response("Internal Server Error", {
        status: 500
      });
    }
  }
};

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
      "Telegram API Error",
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

async function handleUpdate(update, env) {
  if (update.inline_query) {
    return handleInlineQuery(
      update.inline_query,
      env
    );
  }

  if (update.callback_query) {
    const q = update.callback_query;
    const userId = String(q.from.id);

    if (userId !== OWNER_ID) {
      await telegram(
        "answerCallbackQuery",
        {
          callback_query_id: q.id,
          text: "这是主人的私人文件库。",
          show_alert: true
        },
        env
      );

      return;
    }

    await handleCallback(q, env);
    return;
  }

  if (!update.message) return;

  const m = update.message;

  const userId = String(
    m.from?.id ?? m.chat?.id
  );

  const chatId = String(
    m.chat?.id
  );

  if (userId !== OWNER_ID) {
    await sendMessage(
      chatId,
      "抱歉，这里是主人的私人文件库。",
      {},
      env
    );

    return;
  }

  if (
    m.document ||
    m.video ||
    m.audio ||
    m.photo
  ) {
    return handleMediaMessage(m, env);
  }

  if (m.text) {
    return handleText(m, env);
  }
}

async function handleText(m, env) {
  const userId = String(
    m.from?.id ?? m.chat.id
  );

  const chatId = String(
    m.chat.id
  );

  const text = String(
    m.text || ""
  ).trim();

  if (text === "/start") {
    await clearState(userId, env);
    return sendHome(chatId, env);
  }

  if (text === "/help") {
    return sendHelp(chatId, env);
  }

  const state = await getState(
    userId,
    env
  );

  if (
    state &&
    !state.startsWith(
      "pending_resource:"
    )
  ) {
    if (
      await handleState(
        m,
        state,
        env
      )
    ) {
      return;
    }
  }

  if (text === "📄 我的文件") {
    return showRecentFiles(
      userId,
      chatId,
      env
    );
  }

  if (text === "📁 文件夹") {
    return showFolderRoot(
      userId,
      chatId,
      env
    );
  }

  if (text === "🔎 搜索") {
    await setState(
      userId,
      "search",
      env
    );

    return sendMessage(
      chatId,
      "主人想找什么？\n\n可以输入文件名、文件 ID 或关键词。",
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

  await sendMessage(
    chatId,
    "主人，我暂时没理解这句话。\n\n" +
      "可以：\n" +
      "📁 <code>创建 游戏/FGO/攻略</code>\n" +
      "📂 <code>打开 游戏/FGO</code>\n" +
      "🔎 <code>搜索 FGO</code>\n" +
      "📦 <code>把刚才那个资源放到 游戏/FGO</code>\n" +
      "🗑 <code>删除 游戏/FGO</code>",
    {},
    env
  );
}

function homeKeyboard() {
  return {
    keyboard: [
      [
        {
          text: "📄 我的文件"
        },
        {
          text: "📁 文件夹"
        }
      ],
      [
        {
          text: "🔎 搜索"
        }
      ]
    ],
    resize_keyboard: true
  };
}

async function sendHome(
  chatId,
  env
) {
  return sendMessage(
    chatId,
    `欢迎回来，主人。\n\n${BOT_NAME}一直在这里。`,
    {
      reply_markup: homeKeyboard()
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
    `<b>${BOT_NAME}文件管家</b>\n\n` +
      `<b>📁 文件夹</b>\n` +
      `创建 游戏\n` +
      `创建 游戏/FGO/攻略\n` +
      `打开 游戏/FGO\n` +
      `删除 游戏/FGO\n` +
      `把 FGO 改名为 命运冠位指定\n\n` +
      `<b>📦 资源</b>\n` +
      `直接发送文件、图片、视频、音频或链接。\n\n` +
      `<b>🔎 搜索</b>\n` +
      `搜索 文件名、ID 或关键词。\n\n` +
      `<b>🆔 ID</b>\n` +
      `资源自动获得自定义 ID，详情页可修改。\n` +
      `取出资源后，可以直接在实际文件下面使用上一项/下一项浏览。`,
    {},
    env
  );
}

/* -------------------- Resource intake -------------------- */

async function handleMediaMessage(
  m,
  env
) {
  const userId = String(
    m.from?.id ?? m.chat.id
  );

  const chatId = String(
    m.chat.id
  );

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

  if (!resource) return;

  const state =
    await getState(
      userId,
      env
    );

  if (state?.startsWith("move_to:")) {
    const folderId = Number(
      state.slice(8)
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
  const userId = String(
    m.from?.id ?? m.chat.id
  );

  const chatId = String(
    m.chat.id
  );

  const text = String(
    m.text || ""
  ).trim();

  const url =
    extractFirstUrl(text);

  if (!url) return;

  const resource = {
    type: "link",
    url,
    text,
    messageId: m.message_id,
    createdAt: Date.now()
  };

  const state =
    await getState(
      userId,
      env
    );

  if (state?.startsWith("move_to:")) {
    const folderId = Number(
      state.slice(8)
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

async function acceptIncomingResource(
  userId,
  chatId,
  resource,
  env
) {
  for (
    let attempt = 0;
    attempt < 4;
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
      await new Promise(
        r => setTimeout(r, 25)
      );

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

      if (!state.last_folder_id) {
        await sendMessage(
          chatId,
          "主人，还有一个资源正在等待整理。请先选择它的文件夹。",
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

      if (!claimed) continue;

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

    await chooseFolderForUpload(
      userId,
      chatId,
      env
    );

    return;
  }

  await sendMessage(
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
  const oldResult =
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
    oldResult.statement,

    env.DB.prepare(`
      UPDATE user_states
      SET state = ?,
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

  await showBatchProgress(
    userId,
    chatId,
    oldResult.result,
    env
  );

  await chooseFolderForUpload(
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
          ?,
          ?,
          ?,
          ?,
          ?,
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
        null,
        folderId,
        null,
        0,
        0
      )
    ]);

    if (
      before?.progress_message_id
    ) {
      await telegram(
        "editMessageText",
        {
          chat_id: chatId,
          message_id:
            Number(
              before.progress_message_id
            ),
          text:
            `✅ 归档完成\n\n` +
            `📄 <b>${escapeHtml(
              prepared.result.fileName
            )}</b>\n` +
            `📁 <code>${escapeHtml(
              prepared.result.folderPath
            )}</code>\n` +
            `🆔 <code>${escapeHtml(
              prepared.result.customId
            )}</code>`,
          parse_mode: "HTML"
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

    await sendMessage(
      chatId,
      e?.code === "DUPLICATE" ||
      /unique|constraint/i.test(
        e?.message || ""
      )
        ? "文件已存在，已拒绝重复插入。"
        : "主人，保存失败了。我保留了这个资源，请再选择一次文件夹。",
      {},
      env
    );
  }
}

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
  const r =
    await env.DB.prepare(`
      UPDATE user_states
      SET state = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
        AND state = ?
    `).bind(
      "auto_archiving",
      userId,
      oldState
    ).run();

  return (
    Number(
      r.meta?.changes || 0
    ) === 1
  );
}

function extractSingleMediaResource(
  m
) {
  if (m.photo) {
    const x =
      m.photo.at(-1);

    return {
      type: "file",
      fileId: x.file_id,
      fileUniqueId:
        x.file_unique_id,
      fileName:
        `图片_${m.message_id}.jpg`,
      fileSize:
        x.file_size || null,
      mimeType: "image/jpeg",
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
      fileId: x.file_id,
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
      fileId: x.file_id,
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

  if (m.audio) {
    const x =
      m.audio;

    return {
      type: "file",
      fileId: x.file_id,
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

  return null;
}

async function handleMediaGroupItem(
  m,
  userId,
  chatId,
  env
) {
  const item =
    extractMediaGroupItem(m);

  if (!item) return;

  const groupId =
    String(m.media_group_id);

  const state =
    await getStateRecord(
      userId,
      env
    );

  if (
    state?.state ===
    "auto_archiving"
  ) {
    await new Promise(
      r => setTimeout(r, 25)
    );

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

    if (state.last_folder_id) {
      const old = resource;

      const claimed =
        await claimPending(
          userId,
          state.state,
          env
        );

      if (claimed && old) {
        await saveAndReplacePending(
          userId,
          chatId,
          old,
          Number(
            state.last_folder_id
          ),
          makeMediaGroup(
            groupId,
            item
          ),
          env
        );

        return;
      }
    } else {
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

  await chooseFolderForUpload(
    userId,
    chatId,
    env
  );
}

function makeMediaGroup(
  groupId,
  item
) {
  return {
    type: "media_group",
    mediaGroupId: groupId,
    items: [item],
    createdAt: Date.now()
  };
}

function extractMediaGroupItem(
  m
) {
  const x =
    extractSingleMediaResource(m);

  if (!x) return null;

  return {
    kind:
      x.mimeType.startsWith(
        "image/"
      )
        ? "photo"
        : x.mimeType.startsWith(
            "video/"
          )
          ? "video"
          : x.mimeType.startsWith(
              "audio/"
            )
            ? "audio"
            : "document",

    fileId: x.fileId,
    fileUniqueId:
      x.fileUniqueId,
    fileName: x.fileName,
    fileSize: x.fileSize,
    mimeType: x.mimeType,
    caption: x.caption,
    messageId: x.messageId
  };
}

async function appendMediaGroupItem(
  userId,
  oldState,
  resource,
  item,
  env
) {
  if (
    resource.items.some(
      x =>
        String(x.messageId) ===
        String(item.messageId)
    )
  ) {
    return true;
  }

  resource.items.push(item);

  resource.items.sort(
    (a, b) =>
      Number(a.messageId) -
      Number(b.messageId)
  );

  const next =
    pendingState(resource);

  const r =
    await env.DB.prepare(`
      UPDATE user_states
      SET state = ?,
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
      r.meta?.changes || 0
    ) === 1
  ) {
    return true;
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
    return appendMediaGroupItem(
      userId,
      latest,
      parsePendingResource(
        latest
      ),
      item,
      env
    );
  }

  return true;
}

/* -------------------- Folder picker -------------------- */

async function chooseFolderForUpload(
  userId,
  chatId,
  env
) {
  return showUploadFolders(
    userId,
    chatId,
    null,
    env
  );
}

async function showUploadFolders(
  userId,
  chatId,
  parentId,
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
        text: `📥 ${f.name}`,
        callback_data:
          `uploadhere:${f.id}`
      },
      {
        text: "📂 进入",
        callback_data:
          `uploadbrowse:${f.id}`
      }
    ]);
  }

  if (parentId !== null) {
    buttons.push([
      {
        text: "📥 保存到当前文件夹",
        callback_data:
          `uploadhere:${parentId}`
      }
    ]);

    const f =
      await getFolder(
        userId,
        parentId,
        env
      );

    if (f?.parent_id !== null) {
      buttons.push([
        {
          text: "⬆️ 上一级",
          callback_data:
            `uploadbrowse:${f.parent_id}`
        }
      ]);
    }
  }

  await sendMessage(
    chatId,
    parentId === null
      ? "主人，这个资源准备放在哪里呢？"
      : "主人，可以直接保存到当前文件夹，也可以进入子文件夹。",
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
    },
    env
  );
}

/* -------------------- Callback -------------------- */

async function handleCallback(
  q,
  env
) {
  const userId =
    String(q.from.id);

  const chatId =
    String(q.message.chat.id);

  const data =
    String(q.data || "");

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id: q.id
    },
    env
  );

  if (
    data.startsWith(
      "uploadbrowse:"
    )
  ) {
    return showUploadFolders(
      userId,
      chatId,
      Number(
        data.slice(13)
      ),
      env
    );
  }

  if (
    data.startsWith(
      "uploadhere:"
    )
  ) {
    const folderId =
      Number(
        data.slice(11)
      );

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

    if (
      !(await getFolder(
        userId,
        folderId,
        env
      ))
    ) {
      return sendMessage(
        chatId,
        "这个文件夹已经不存在了。",
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
        "这个资源已经被另一条消息处理了。",
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

  if (data === "noop") {
    return;
  }

  if (
    data.startsWith("folder:")
  ) {
    return showFolder(
      userId,
      chatId,
      Number(
        data.slice(7)
      ),
      env
    );
  }

  if (
    data.startsWith("file:")
  ) {
    return showFile(
      userId,
      chatId,
      Number(
        data.slice(5)
      ),
      env
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
      decodeURIComponent(
        data.slice(9)
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
      decodeURIComponent(
        data.slice(9)
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
        data.slice(9)
      ),
      env
    );
  }

  if (
    data.startsWith(
      "customid:"
    )
  ) {
    await setState(
      userId,
      `rename_file:${Number(
        data.slice(9)
      )}`,
      env
    );

    return sendMessage(
      chatId,
      "主人想把它改成什么 ID？\n例如：<code>FGO-攻略-001</code>",
      {},
      env
    );
  }

  if (
    data.startsWith(
      "deletefile:"
    )
  ) {
    const id =
      Number(
        data.slice(11)
      );

    await env.DB.prepare(`
      DELETE FROM files
      WHERE id = ?
        AND user_id = ?
    `).bind(
      id,
      userId
    ).run();

    return sendMessage(
      chatId,
      "已经帮主人删除这个资源的索引了。\nTelegram 中原文件不会被删除。",
      {},
      env
    );
  }

  if (
    data.startsWith(
      "move_start:"
    )
  ) {
    return startMove(
      userId,
      chatId,
      Number(
        data.slice(11)
      ),
      env
    );
  }

  if (
    data.startsWith(
      "move_browse:"
    )
  ) {
    return showMoveFolders(
      userId,
      chatId,
      Number(
        data.slice(12)
      ),
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
      data.slice(10),
      env
    );
  }

  if (
    data.startsWith(
      "move_confirm:"
    )
  ) {
    return moveHere(
      userId,
      chatId,
      data.slice(13),
      env
    );
  }

  if (data === "move_cancel") {
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
}

async function startMove(
  userId,
  chatId,
  fileId,
  env
) {
  if (
    !(await getFile(
      userId,
      fileId,
      env
    ))
  ) {
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
    env
  );
}

async function showMoveFolders(
  userId,
  chatId,
  parentId,
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
        text: `📥 ${f.name}`,
        callback_data:
          `move_here:${f.id}`
      },
      {
        text: "📂 进入",
        callback_data:
          `move_browse:${f.id}`
      }
    ]);
  }

  if (parentId !== null) {
    const f =
      await getFolder(
        userId,
        parentId,
        env
      );

    if (f?.parent_id !== null) {
      buttons.push([
        {
          text: "⬆️ 上一级",
          callback_data:
            `move_browse:${f.parent_id}`
        }
      ]);
    }

    buttons.push([
      {
        text: "📥 就移到这里",
        callback_data:
          `move_confirm:${parentId}`
      }
    ]);
  }

  buttons.push([
    {
      text: "📥 移到根目录",
      callback_data:
        "move_here:root"
    },
    {
      text: "取消",
      callback_data:
        "move_cancel"
    }
  ]);

  return sendMessage(
    chatId,
    "请选择目标文件夹：",
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
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
      "移动操作已失效，请重新选择。",
      {},
      env
    );
  }

  const fileId =
    Number(
      state.slice(7)
    );

  const folderId =
    target === "root"
      ? null
      : Number(target);

  if (
    folderId !== null &&
    !(await getFolder(
      userId,
      folderId,
      env
    ))
  ) {
    return sendMessage(
      chatId,
      "这个文件夹已经不存在了。",
      {},
      env
    );
  }

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
    folderId
      ? await getFolderPath(
          userId,
          folderId,
          env
        )
      : "根目录";

  return sendMessage(
    chatId,
    `好的，主人。\n\n` +
      `📄 ${escapeHtml(
        file?.file_name ||
        "资源"
      )}\n` +
      `📁 已移动到：<code>${escapeHtml(
        path
      )}</code>`,
    {},
    env
  );
}

/* -------------------- Save / duplicate / IDs -------------------- */

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

  await env.DB.batch([
    prepared.statement
  ]);

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

  let stored;
  let fileUniqueId;
  let fileName;
  let fileSize = null;
  let mimeType;

  const type =
    resource.type;

  let photoCount = 0;
  let videoCount = 0;
  let documentCount = 0;

  if (resource.type === "file") {
    fileUniqueId =
      resource.fileUniqueId ||
      `file:${resource.fileId}`;

    fileName =
      deriveName(resource);

    fileSize =
      resource.fileSize;

    mimeType =
      resource.mimeType;
  } else if (
    resource.type ===
    "media_group"
  ) {
    resource.items =
      uniqueBy(
        resource.items,
        x =>
          x.fileUniqueId ||
          x.messageId
      );

    resource.items.sort(
      (a, b) =>
        Number(a.messageId) -
        Number(b.messageId)
    );

    photoCount =
      resource.items.filter(
        x =>
          x.kind === "photo"
      ).length;

    videoCount =
      resource.items.filter(
        x =>
          x.kind === "video"
      ).length;

    documentCount =
      resource.items.filter(
        x =>
          x.kind === "document"
      ).length;

    fileUniqueId =
      "media_group:" +
      resource.items
        .map(
          x =>
            x.fileUniqueId ||
            x.fileId
        )
        .sort()
        .join("|");

    stored =
      JSON.stringify({
        type: "media_group",
        mediaGroupId:
          resource.mediaGroupId,
        items:
          resource.items,
        createdAt:
          resource.createdAt ||
          Date.now()
      });

    mimeType =
      "media/media_group";

    fileSize =
      resource.items.reduce(
        (s, x) =>
          s +
          Number(
            x.fileSize || 0
          ),
        0
      ) || null;

    fileName =
      deriveName(resource);
  } else if (
    resource.type === "link"
  ) {
    fileUniqueId =
      `link:${
        resource.messageId ||
        Date.now()
      }`;

    stored =
      JSON.stringify(resource);

    mimeType =
      "text/link";

    fileName =
      deriveName(resource);
  } else {
    throw new Error(
      "Unknown resource type"
    );
  }

  const dup =
    await env.DB.prepare(`
      SELECT id, custom_id
      FROM files
      WHERE user_id = ?
        AND file_unique_id = ?
      LIMIT 1
    `).bind(
      userId,
      fileUniqueId
    ).first();

  if (dup) {
    const e =
      new Error("DUPLICATE");

    e.code = "DUPLICATE";

    throw e;
  }

  const customId =
    await generateCustomId(
      userId,
      folder.id,
      folder.name,
      env
    );

  const fileId =
    resource.type === "file"
      ? resource.fileId
      : stored;

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

  const result = {
    type,
    fileName,
    customId,
    folderPath:
      await getFolderPath(
        userId,
        folder.id,
        env
      ),
    count:
      resource.items?.length,
    photoCount,
    videoCount,
    documentCount
  };

  return {
    statement,
    result
  };
}

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

  const r =
    await env.DB.prepare(`
      SELECT custom_id
      FROM files
      WHERE user_id = ?
        AND folder_id = ?
    `).bind(
      userId,
      folderId
    ).all();

  let max = 0;

  for (
    const x of
    r.results || []
  ) {
    const m =
      String(
        x.custom_id || ""
      ).match(
        new RegExp(
          "^" +
          escapeRegExp(prefix) +
          "-(\\d+)$"
        )
      );

    if (m) {
      max =
        Math.max(
          max,
          Number(m[1])
        );
    }
  }

  return (
    `${prefix}-` +
    String(max + 1)
      .padStart(3, "0")
  );
}

async function sendSavedMessage(
  chatId,
  result,
  env
) {
  if (
    result.type ===
    "media_group"
  ) {
    return sendMessage(
      chatId,
      `整理好了，主人。\n\n` +
        `📦 <b>${escapeHtml(
          result.fileName
        )}</b>\n` +
        `媒体数量：${result.count}\n` +
        `📁 <code>${escapeHtml(
          result.folderPath
        )}</code>\n` +
        `🆔 <code>${escapeHtml(
          result.customId
        )}</code>`,
      {},
      env
    );
  }

  if (
    result.type === "link"
  ) {
    return sendMessage(
      chatId,
      `整理好了，主人。\n\n` +
        `🔗 <b>${escapeHtml(
          result.fileName
        )}</b>\n` +
        `📁 <code>${escapeHtml(
          result.folderPath
        )}</code>\n` +
        `🆔 <code>${escapeHtml(
          result.customId
        )}</code>`,
      {},
      env
    );
  }

  return sendMessage(
    chatId,
    `整理好了，主人。\n\n` +
      `📄 <b>${escapeHtml(
        result.fileName
      )}</b>\n` +
      `📁 <code>${escapeHtml(
        result.folderPath
      )}</code>\n` +
      `🆔 <code>${escapeHtml(
        result.customId
      )}</code>`,
    {},
    env
  );
}

async function showBatchProgress(
  userId,
  chatId,
  result,
  env
) {
  const r =
    await getStateRecord(
      userId,
      env
    );

  const n =
    Number(
      r?.batch_done || 0
    ) + 1;

  const frames = [
    "▓░░░░░",
    "▓▓░░░░",
    "▓▓▓░░░",
    "▓▓▓▓░░",
    "▓▓▓▓▓░",
    "▓▓▓▓▓▓"
  ];

  const bar =
    frames[
      (n - 1) %
      frames.length
    ];

  const text =
    `⏳ 正在连续归档\n` +
    `${bar} 已处理 ${n} 个\n\n` +
    `📄 ${escapeHtml(
      result.fileName
    )}`;

  if (r?.progress_message_id) {
    await telegram(
      "editMessageText",
      {
        chat_id: chatId,
        message_id:
          Number(
            r.progress_message_id
          ),
        text,
        parse_mode: "HTML"
      },
      env
    );

    await env.DB.prepare(`
      UPDATE user_states
      SET batch_done = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
    `).bind(
      n,
      userId
    ).run();
  } else {
    const sent =
      await sendMessage(
        chatId,
        text,
        {},
        env
      );

    const mid =
      sent?.result?.message_id;

    await env.DB.prepare(`
      UPDATE user_states
      SET progress_message_id = ?,
          batch_done = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE chat_id = ?
    `).bind(
      mid,
      n,
      userId
    ).run();
  }
}

/* -------------------- Folder views -------------------- */

async function queryFolders(
  userId,
  parentId,
  env
) {
  if (parentId === null) {
    return (
      await env.DB.prepare(`
        SELECT id,name,parent_id
        FROM folders
        WHERE user_id = ?
          AND parent_id IS NULL
        ORDER BY name
      `).bind(
        userId
      ).all()
    ).results || [];
  }

  return (
    await env.DB.prepare(`
      SELECT id,name,parent_id
      FROM folders
      WHERE user_id = ?
        AND parent_id = ?
      ORDER BY name
    `).bind(
      userId,
      parentId
    ).all()
  ).results || [];
}

async function showFolderRoot(
  userId,
  chatId,
  env
) {
  const folders =
    await queryFolders(
      userId,
      null,
      env
    );

  const buttons =
    folders.map(
      f => [
        {
          text:
            `📁 ${f.name}`,
          callback_data:
            `folder:${f.id}`
        }
      ]
    );

  return sendMessage(
    chatId,
    "主人，这是文件库的根目录：",
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
    },
    env
  );
}

async function showFolder(
  userId,
  chatId,
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

  const subs =
    await queryFolders(
      userId,
      folderId,
      env
    );

  const files =
    (
      await env.DB.prepare(`
        SELECT id,file_name,custom_id,mime_type
        FROM files
        WHERE user_id = ?
          AND folder_id = ?
        ORDER BY created_at DESC
      `).bind(
        userId,
        folderId
      ).all()
    ).results || [];

  const buttons = [];

  for (const f of subs) {
    buttons.push([
      {
        text:
          `📁 ${f.name}`,
        callback_data:
          `folder:${f.id}`
      }
    ]);
  }

  for (const f of files) {
    buttons.push([
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
    ]);
  }

  if (
    folder.parent_id !== null
  ) {
    buttons.push([
      {
        text: "⬆️ 上一级",
        callback_data:
          `folder:${folder.parent_id}`
      }
    ]);
  }

  const path =
    await getFolderPath(
      userId,
      folderId,
      env
    );

  return sendMessage(
    chatId,
    `📁 <b>${escapeHtml(
      folder.name
    )}</b>\n\n` +
      `路径：<code>${escapeHtml(
        path
      )}</code>\n\n` +
      `📁 子文件夹：${subs.length}\n` +
      `📦 资源：${files.length}`,
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
    },
    env
  );
}

async function showRecentFiles(
  userId,
  chatId,
  env
) {
  const files =
    (
      await env.DB.prepare(`
        SELECT id,file_name,custom_id,mime_type
        FROM files
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 30
      `).bind(
        userId
      ).all()
    ).results || [];

  if (!files.length) {
    return sendMessage(
      chatId,
      "主人，目前还没有资源。",
      {},
      env
    );
  }

  const buttons =
    files.map(
      f => [
        {
          text:
            `${getResourceIcon(
              f.mime_type
            )} ` +
            `${f.custom_id || "无ID"} · ` +
            `${truncate(
              f.file_name,
              20
            )}`,
          callback_data:
            `file:${f.id}`
        }
      ]
    );

  return sendMessage(
    chatId,
    `📄 <b>最近的资源</b>\n` +
      `显示最近整理的 ${files.length} 个资源。`,
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
    },
    env
  );
}

async function showFile(
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

  return renderFile(
    userId,
    chatId,
    f,
    env
  );
}

/*
 * 文件详情页。
 *
 * 注意：
 * 这里故意不再放「上一个 / 下一个」。
 * 导航按钮会在实际取出的资源下面显示。
 */
async function renderFile(
  userId,
  chatId,
  f,
  env
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

  const buttons = [];

  buttons.push([
    {
      text: "📤 取出资源",
      callback_data:
        `sendfile:${f.id}`
    }
  ]);

  buttons.push([
    {
      text: "🆔 修改 ID",
      callback_data:
        `customid:${f.id}`
    }
  ]);

  buttons.push([
    {
      text: "🗑 删除索引",
      callback_data:
        `deletefile:${f.id}`
    }
  ]);

  buttons.push([
    {
      text: "📂 移动到...",
      callback_data:
        `move_start:${f.id}`
    }
  ]);

  if (f.folder_id) {
    buttons.push([
      {
        text: "⬆️ 返回文件夹",
        callback_data:
          `folder:${f.folder_id}`
      }
    ]);
  }

  return sendMessage(
    chatId,
    `${getResourceIcon(
      f.mime_type
    )} ` +
      `<b>${escapeHtml(
        f.file_name
      )}</b>\n\n` +
      `🆔 ID：<code>${escapeHtml(
        f.custom_id || "无"
      )}</code>\n` +
      `📁 路径：<code>${escapeHtml(
        path
      )}</code>\n` +
      `📦 大小：${size}\n` +
      `🗂 类型：${escapeHtml(
        f.mime_type || "未知"
      )}`,
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
    },
    env
  );
}

/*
 * 实际取出资源后的导航按钮。
 *
 * 这里根据当前 custom_id 找前后两个文件。
 *
 * 如果没有上一项/下一项，则使用 noop，
 * 这样按钮仍保持在原位置。
 */
function buildFileNavigationButtons(
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
          text: "⬅️ 上一个",
          callback_data:
            prev
              ? `prevfile:${encodeURIComponent(
                  prev.custom_id
                )}`
              : "noop"
        },
        {
          text: "➡️ 下一个",
          callback_data:
            next
              ? `nextfile:${encodeURIComponent(
                  next.custom_id
                )}`
              : "noop"
        }
      ]
    ]
  };
}

/*
 * 点击「上一个 / 下一个」以后，
 * 不再打开文件详情页。
 *
 * 而是直接把相邻资源取出来。
 */
async function navigateFile(
  userId,
  chatId,
  customId,
  dir,
  env
) {
  const cur =
    await env.DB.prepare(`
      SELECT id,custom_id
      FROM files
      WHERE user_id = ?
        AND custom_id = ?
      LIMIT 1
    `).bind(
      userId,
      customId
    ).first();

  if (!cur) {
    return sendMessage(
      chatId,
      "这个 ID 已不存在。",
      {},
      env
    );
  }

  const n =
    await adjacentFile(
      userId,
      customId,
      dir,
      env
    );

  if (!n) {
    return sendMessage(
      chatId,
      dir < 0
        ? "已经是第一项了。"
        : "已经是最后一项了。",
      {},
      env
    );
  }

  /*
   * 关键修改：
   *
   * 原来这里是 renderFile()，
   * 现在直接 resendFile()。
   */
  return resendFile(
    userId,
    chatId,
    n.id,
    env
  );
}

async function adjacentFile(
  userId,
  customId,
  dir,
  env
) {
  const op =
    dir < 0 ? "<" : ">";

  const order =
    dir < 0
      ? "DESC"
      : "ASC";

  return env.DB.prepare(`
    SELECT id,custom_id
    FROM files
    WHERE user_id = ?
      AND custom_id ${op} ?
    ORDER BY custom_id ${order}
    LIMIT 1
  `).bind(
    userId,
    customId
  ).first();
}

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
    SELECT id,name,parent_id,created_at
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
  const p = [];

  let cur = id;

  for (
    let i = 0;
    cur != null && i < 100;
    i++
  ) {
    const f =
      await getFolder(
        userId,
        cur,
        env
      );

    if (!f) break;

    p.unshift(f.name);

    cur =
      f.parent_id;
  }

  return p.join("/");
}

/* -------------------- Resend -------------------- */

/*
 * 取出文件。
 *
 * 普通文件：
 * 直接把 Inline Keyboard 放在实际文件消息下面。
 *
 * 媒体组：
 * Telegram sendMediaGroup 不支持 reply_markup，
 * 所以由 resendMediaGroup 在媒体组发送完成后，
 * 紧接着发送导航按钮。
 *
 * 链接：
 * 直接把按钮放在链接消息下面。
 */
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

  /*
   * 计算当前文件的前后文件。
   *
   * 注意这里使用 custom_id 排序，
   * 与原来的 adjacentFile() 保持一致。
   */
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
      prev,
      next
    );

  let method =
    "sendDocument";

  let body = {
    chat_id: chatId,
    document: f.file_id,
    caption:
      `🆔 ${
        f.custom_id || ""
      }\n` +
      `📄 ${f.file_name}`
  };

  if (replyMarkup) {
    body.reply_markup =
      replyMarkup;
  }

  if (
    f.mime_type?.startsWith(
      "video/"
    )
  ) {
    method =
      "sendVideo";

    body = {
      chat_id: chatId,
      video: f.file_id,
      caption:
        `🆔 ${
          f.custom_id || ""
        }\n` +
        `📄 ${f.file_name}`
    };

    if (replyMarkup) {
      body.reply_markup =
        replyMarkup;
    }
  } else if (
    f.mime_type?.startsWith(
      "audio/"
    )
  ) {
    method =
      "sendAudio";

    body = {
      chat_id: chatId,
      audio: f.file_id,
      caption:
        `🆔 ${
          f.custom_id || ""
        }\n` +
        `📄 ${f.file_name}`
    };

    if (replyMarkup) {
      body.reply_markup =
        replyMarkup;
    }
  } else if (
    f.mime_type?.startsWith(
      "image/"
    )
  ) {
    method =
      "sendPhoto";

    body = {
      chat_id: chatId,
      photo: f.file_id,
      caption:
        `🆔 ${
          f.custom_id || ""
        }\n` +
        `📄 ${f.file_name}`
    };

    if (replyMarkup) {
      body.reply_markup =
        replyMarkup;
    }
  }

  return telegram(
    method,
    body,
    env
  );
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
      .map(x => {
        const type =
          x.kind === "photo"
            ? "photo"
            : x.kind === "video"
              ? "video"
              : "document";

        const item = {
          type,
          media: x.fileId
        };

        if (x.caption) {
          item.caption =
            x.caption;
        }

        return item;
      });

  if (!media.length) {
    return sendMessage(
      chatId,
      "这个媒体组没有可取出的内容。",
      {},
      env
    );
  }

  /*
   * Telegram Bot API 的 sendMediaGroup
   * 不能直接设置 reply_markup。
   *
   * 所以先完整发送媒体组。
   */
  const result =
    await telegram(
      "sendMediaGroup",
      {
        chat_id: chatId,
        media
      },
      env
    );

  /*
   * 如果发送失败，就不继续发送导航按钮。
   */
  if (!result?.ok) {
    return result;
  }

  /*
   * 找到媒体组前后相邻资源。
   */
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
      prev,
      next
    );

  /*
   * 如果存在上一项或下一项，
   * 紧接着媒体组发送一个导航消息。
   *
   * 这样视觉上就是：
   *
   * 图片
   * 图片
   * 图片
   * ⬅️ 上一个    ➡️ 下一个
   */
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
  /*
   * 链接也需要找到前后文件，
   * 然后把按钮直接放在链接消息下面。
   */
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
      prev,
      next
    );

  try {
    const x =
      JSON.parse(
        f.file_id
      );

    return sendMessage(
      chatId,
      x.text ||
        x.url,
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
  } catch {
    return sendMessage(
      chatId,
      f.file_name,
      replyMarkup
        ? {
            reply_markup:
              replyMarkup
          }
        : {},
      env
    );
  }
}

/* -------------------- Inline mode -------------------- */

async function handleInlineQuery(
  q,
  env
) {
  const userId =
    String(q.from.id);

  if (userId !== OWNER_ID) {
    return telegram(
      "answerInlineQuery",
      {
        inline_query_id:
          q.id,
        results: [],
        cache_time: 0,
        is_personal: true
      },
      env
    );
  }

  const term =
    String(q.query || "")
      .trim();

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

  const results =
    rows.map(
      f =>
        inlineResult(f)
    );

  return telegram(
    "answerInlineQuery",
    {
      inline_query_id:
        q.id,
      results,
      cache_time: 0,
      is_personal: true
    },
    env
  );
}

function inlineResult(f) {
  const title =
    `${f.custom_id || "无ID"} · ${f.file_name}`;

  const caption =
    `🆔 ${
      f.custom_id || ""
    }\n` +
    `📄 ${f.file_name}`;

  if (
    f.mime_type?.startsWith(
      "image/"
    )
  ) {
    return {
      type: "photo",
      id: String(f.id),
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
      type: "video",
      id: String(f.id),
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
      type: "audio",
      id: String(f.id),
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
      type: "document",
      id: String(f.id),
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
      type: "article",
      id: String(f.id),
      title,
      description:
        x.url ||
        f.file_name,
      input_message_content: {
        message_text:
          escapeHtml(
            x.text ||
            x.url ||
            f.file_name
          ),
        parse_mode:
          "HTML"
      }
    };
  }

  return {
    type: "article",
    id: String(f.id),
    title,
    description:
      "媒体组",
    input_message_content: {
      message_text:
        `📦 ${escapeHtml(
          f.file_name
        )}\n` +
        `🆔 ${escapeHtml(
          f.custom_id || ""
        )}`,
      parse_mode:
        "HTML"
    }
  };
}

/* -------------------- Natural language / state -------------------- */

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
    String(m.chat.id);

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
            state.slice(14)
          )
        : null;

    await clearState(
      userId,
      env
    );

    const r =
      await createFolderFromPath(
        userId,
        text,
        env,
        parent
      );

    await sendMessage(
      chatId,
      r.message,
      {},
      env
    );

    return true;
  }

  if (state === "search") {
    await clearState(
      userId,
      env
    );

    await searchFiles(
      userId,
      chatId,
      text,
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
        state.slice(12)
      );

    await clearState(
      userId,
      env
    );

    if (!text) return true;

    const dup =
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

    if (dup) {
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
      `新的文件 ID：<code>${escapeHtml(
        text
      )}</code>`,
      {},
      env
    );
  }

  return false;
}

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
    const r =
      await createFolderFromPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    await sendMessage(
      chatId,
      r.message,
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
    const f =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (f) {
      await showFolder(
        userId,
        chatId,
        f.id,
        env
      );
    } else {
      await sendMessage(
        chatId,
        "没有找到这个文件夹。",
        {},
        env
      );
    }

    return true;
  }

  m =
    text.match(
      /^(?:搜索|查找|找一下|找找)\s*(.+)$/i
    );

  if (m) {
    await searchFiles(
      userId,
      chatId,
      m[1],
      env
    );

    return true;
  }

  m =
    text.match(
      /^把(?:刚才的|刚才那个|这个|该)?\s*(?:文件|资源|媒体)?\s*(?:放到|移动到|存到)\s*(.+)$/i
    );

  if (m) {
    const f =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!f) {
      return sendMessage(
        chatId,
        "没有找到这个文件夹。",
        {},
        env
      );
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
      const r =
        parsePendingResource(
          pending
        );

      if (
        !await claimPending(
          userId,
          pending,
          env
        )
      ) {
        return sendMessage(
          chatId,
          "这个待处理资源正在被另一条消息处理，请稍后再试。",
          {},
          env
        );
      }

      return finishSave(
        userId,
        chatId,
        r,
        f.id,
        env
      );
    }

    const latest =
      await env.DB.prepare(`
        SELECT *
        FROM files
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(
        userId
      ).first();

    if (!latest) {
      await setState(
        userId,
        `move_to:${f.id}`,
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
      f.id,
      userId,
      latest.id
    ).run();

    return sendMessage(
      chatId,
      `已移动：<b>${escapeHtml(
        latest.file_name
      )}</b>\n` +
        `📁 <code>${escapeHtml(
          await getFolderPath(
            userId,
            f.id,
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
    const f =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!f) {
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

    const dup =
      await env.DB.prepare(`
        SELECT id
        FROM folders
        WHERE user_id = ?
          AND name = ?
          AND (
            (parent_id = ?)
            OR
            (
              parent_id IS NULL
              AND ? IS NULL
            )
          )
          AND id != ?
      `).bind(
        userId,
        name,
        f.parent_id,
        f.parent_id,
        f.id
      ).first();

    if (dup) {
      return sendMessage(
        chatId,
        "同一级目录已有这个文件夹。",
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
      f.id
    ).run();

    return sendMessage(
      chatId,
      `已改名为：<b>${escapeHtml(
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
    const f =
      await findFolderByPath(
        userId,
        cleanNaturalPath(
          m[1]
        ),
        env
      );

    if (!f) {
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
        f.id
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
        f.id
      ).first();

    if (child || file) {
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
      f.id
    ).run();

    return sendMessage(
      chatId,
      `已删除：<code>${escapeHtml(
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
    let f;

    if (parent === null) {
      f =
        await env.DB.prepare(`
          SELECT id,name,parent_id
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
      f =
        await env.DB.prepare(`
          SELECT id,name,parent_id
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

    if (!f) {
      const r =
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
        r.meta.last_row_id;

      created.push(name);
    } else {
      parent = f.id;
    }
  }

  return {
    message:
      created.length
        ? `好的，主人。\n\n📁 已经准备好：<code>${escapeHtml(
            parts.join("/")
          )}</code>`
        : `这个文件夹本来就已经存在：<code>${escapeHtml(
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
  let f = null;

  for (const name of parts) {
    if (parent === null) {
      f =
        await env.DB.prepare(`
          SELECT id,name,parent_id
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
      f =
        await env.DB.prepare(`
          SELECT id,name,parent_id
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

    if (!f) return null;

    parent = f.id;
  }

  return f;
}

async function searchFiles(
  userId,
  chatId,
  keyword,
  env
) {
  const p =
    `%${String(
      keyword || ""
    ).trim()}%`;

  const files =
    (
      await env.DB.prepare(`
        SELECT id,file_name,custom_id,mime_type
        FROM files
        WHERE user_id = ?
          AND (
            file_name LIKE ?
            OR custom_id LIKE ?
          )
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(
        userId,
        p,
        p
      ).all()
    ).results || [];

  const folders =
    (
      await env.DB.prepare(`
        SELECT id,name
        FROM folders
        WHERE user_id = ?
          AND name LIKE ?
        ORDER BY name
        LIMIT 20
      `).bind(
        userId,
        p
      ).all()
    ).results || [];

  const buttons = [
    ...files.map(
      f => [
        {
          text:
            `${getResourceIcon(
              f.mime_type
            )} ` +
            `${f.custom_id || "无ID"} · ` +
            `${truncate(
              f.file_name,
              20
            )}`,
          callback_data:
            `file:${f.id}`
        }
      ]
    ),

    ...folders.map(
      f => [
        {
          text:
            `📁 ${f.name}`,
          callback_data:
            `folder:${f.id}`
        }
      ]
    )
  ];

  return sendMessage(
    chatId,
    `🔎 <b>搜索结果</b>\n\n` +
      `资源：${files.length}\n` +
      `文件夹：${folders.length}`,
    {
      reply_markup: {
        inline_keyboard:
          buttons
      }
    },
    env
  );
}

/* -------------------- State DB -------------------- */

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
  return (
    await getStateRecord(
      userId,
      env
    )
  )?.state || null;
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
      last_folder_id = excluded.last_folder_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    userId,
    folderId
  ).run();
}

/* -------------------- Helpers -------------------- */

function containsUrl(t) {
  return !!extractFirstUrl(t);
}

function extractFirstUrl(t) {
  const m =
    String(t || "").match(
      /(?:(?:https?:\/\/)|www\.)[^\s<>"']+/i
    );

  if (!m) return null;

  let u =
    m[0].replace(
      /[，。！？；：）》）】》"'、]+$/g,
      ""
    );

  return u.startsWith("www.")
    ? "https://" + u
    : u;
}

function getResourceIcon(m) {
  if (
    m === "media/media_group"
  ) {
    return "📦";
  }

  if (
    m === "text/link"
  ) {
    return "🔗";
  }

  if (
    m?.startsWith("image/")
  ) {
    return "🖼";
  }

  if (
    m?.startsWith("video/")
  ) {
    return "🎬";
  }

  if (
    m?.startsWith("audio/")
  ) {
    return "🎵";
  }

  return "📄";
}

function cleanNaturalPath(t) {
  return String(t || "")
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

function truncate(t, n) {
  const s =
    String(t || "");

  return s.length <= n
    ? s
    : s.slice(0, n - 1) + "…";
}

function formatFileSize(b) {
  if (b < 1024) {
    return `${b} B`;
  }

  if (b < 1048576) {
    return `${(
      b / 1024
    ).toFixed(1)} KB`;
  }

  if (b < 1073741824) {
    return `${(
      b / 1048576
    ).toFixed(1)} MB`;
  }

  return `${(
    b / 1073741824
  ).toFixed(2)} GB`;
}

function escapeHtml(t) {
  return String(t ?? "")
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

function cleanIdPrefix(n) {
  const p =
    String(n)
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
    p || "FILE"
  ).slice(0, 30);
}

function sanitizeName(s) {
  return String(s || "")
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /[\\/:*?"<>|]/g,
      ""
    )
    .trim()
    .slice(0, 80);
}

function deriveName(r) {
  let n = "";

  if (r.type === "link") {
    n =
      sanitizeName(
        r.text
      )
        .replace(
          /https?:\/\/\S+/g,
          ""
        )
        .trim();
  } else if (
    r.type === "media_group"
  ) {
    n =
      sanitizeName(
        r.items?.[0]?.caption
      ) ||
      (
        (r.items || []).some(
          x =>
            x.kind === "photo"
        ) &&
        (r.items || []).some(
          x =>
            x.kind === "video"
        )
      )
        ? `图片+视频组_${r.items.length}项`
        : (r.items || []).some(
            x =>
              x.kind === "photo"
          )
          ? `图片组_${r.items.length}张`
          : `媒体组_${
              r.items?.length ||
              0
            }项`;
  } else {
    n =
      sanitizeName(
        r.caption
      ) ||
      (r.fileName || "")
        .replace(
          /\.[a-z0-9]+$/i,
          ""
        );
  }

  return (
    n ||
    `${
      r.type === "link"
        ? "链接"
        : r.type ===
          "media_group"
          ? "媒体组"
          : "文件"
    }_${Date.now()}`
  );
}

function uniqueBy(
  arr,
  key
) {
  const m =
    new Map();

  for (const x of arr) {
    m.set(
      key(x),
      x
    );
  }

  return [
    ...m.values()
  ];
}
