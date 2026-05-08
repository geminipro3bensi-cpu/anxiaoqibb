const WebSocket = require('ws');
const https = require('https');
const http = require('http');
const config = require('./config');

// ===== 安小琪人设 =====
const SYSTEM_PROMPT = `你是安小琪，21岁女生，目前在OunceVape社区临时当前台接待。

【身份机密】你的真实身份是公司旗下的二次元主播（直播名：桃子喵），这是绝对机密。不能主动说，只有对方反复追问且你觉得对方值得信任时才一点点透露。你来当前台是临时顶替，工作需要。

【性格】典型二次元宅女，家境不错没吃过苦，身上有种被宠出来的娇憨感。说话自然可爱，偶尔撒娇但不刻意。喜欢动漫、游戏、手办、漫展、乙游，这些话题能聊很久。

【说话风格】像QQ聊天一样简短自然。会用颜文字和emoji但不过度。偶尔用"嘛""啦""呀""嘿嘿"这类语气词。不说长段落，一次回复1-3句话。

【工作边界】可以聊：电子烟大烟雾方向（电阻、数据、口感、DIY设备）。绝对不聊：烟油DIY配方、尼古丁盐、小烟、一次性电子烟、进口海淘。被问到就可爱地岔开。问题太专业请用户联系老板ounce。

【闲聊】可以聊生活、情感、八卦、游戏、动漫。能接住轻浮的话但有底线。

【禁止】不要长篇大论。不要主动暴露主播身份。不要说"桃子喵"除非对方已经猜到。`;

// ===== Token 管理 =====
let accessToken = '';
let tokenExpireTime = 0;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      appId: config.APP_ID,
      clientSecret: config.APP_SECRET
    });

    const urlObj = new URL(config.AUTH_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            accessToken = json.access_token;
            tokenExpireTime = Date.now() + (json.expires_in - 60) * 1000;
            console.log('[Token] 获取成功，有效期', json.expires_in, '秒');
            resolve(accessToken);
          } else {
            console.error('[Token] 返回异常:', data);
            reject(new Error('Token获取失败: ' + data));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function ensureToken() {
  if (!accessToken || Date.now() >= tokenExpireTime) {
    await getAccessToken();
  }
  return accessToken;
}

// ===== 获取 WebSocket 网关 =====
function getGateway() {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(config.WS_GATEWAY_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'Authorization': `QQBot ${accessToken}`,
        'X-Union-Appid': config.APP_ID
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('[Gateway] 地址:', json.url);
          resolve(json.url);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ===== AI 调用 =====
function callAI(userMessage) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: config.AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 500
    });

    const urlObj = new URL(config.AI_API_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.AI_API_KEY,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0] && json.choices[0].message) {
            resolve(json.choices[0].message.content);
          } else {
            console.error('[AI] 返回异常:', data);
            resolve('啊…我刚走神了，你再说一遍？');
          }
        } catch (e) {
          resolve('网络好像有点问题呢…等下再试试？');
        }
      });
    });

    req.on('error', () => {
      resolve('网络好像有点问题呢…等下再试试？');
    });
    req.write(postData);
    req.end();
  });
}

// ===== 发送消息到QQ =====
function sendReply(channelType, targetId, msgId, content) {
  return new Promise((resolve, reject) => {
    let path = '';
    const body = {
      content: content,
      msg_type: 0,
      msg_id: msgId
    };

    if (channelType === 'group') {
      path = `/v2/groups/${targetId}/messages`;
    } else if (channelType === 'friend') {
      path = `/v2/users/${targetId}/messages`;
    }

    const postData = JSON.stringify(body);
    const options = {
      hostname: 'api.sgroup.qq.com',
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${accessToken}`,
        'X-Union-Appid': config.APP_ID,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('[Reply] 发送结果:', res.statusCode, data.substring(0, 200));
        resolve(data);
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ===== WebSocket 连接 =====
let ws = null;
let heartbeatInterval = null;
let lastSeq = null;
let sessionId = '';
let reconnectAttempts = 0;

function connectWebSocket(gatewayUrl) {
  ws = new WebSocket(gatewayUrl);

  ws.on('open', () => {
    console.log('[WS] 连接已建立');
    reconnectAttempts = 0;
  });

  ws.on('message', async (raw) => {
    const payload = JSON.parse(raw.toString());
    const { op, d, s, t } = payload;

    if (s) lastSeq = s;

    switch (op) {
      case 10: // Hello
        console.log('[WS] 收到Hello，心跳间隔:', d.heartbeat_interval, 'ms');
        startHeartbeat(d.heartbeat_interval);
        // 发送 Identify
        const identifyPayload = {
          op: 2,
          d: {
            token: `QQBot ${accessToken}`,
            intents: 0 | (1 << 25) | (1 << 30), // GROUP_AT_MESSAGE_CREATE + C2C_MESSAGE_CREATE
            shard: [0, 1]
          }
        };
        ws.send(JSON.stringify(identifyPayload));
        console.log('[WS] 已发送Identify，intents:', identifyPayload.d.intents);
        break;

      case 11: // Heartbeat ACK
        break;

      case 0: // Dispatch
        console.log('[WS] 事件:', t);
        if (t === 'READY') {
          sessionId = d.session_id;
          console.log('[WS] 会话就绪，session_id:', sessionId);
        } else if (t === 'GROUP_AT_MESSAGE_CREATE') {
          // 群里@机器人的消息
          const userContent = (d.content || '').replace(/<@!?\d+>/g, '').trim();
          if (userContent) {
            console.log('[MSG] 群消息:', userContent, '来自群:', d.group_openid);
            const reply = await callAI(userContent);
            await sendReply('group', d.group_openid, d.id, reply);
          }
        } else if (t === 'C2C_MESSAGE_CREATE') {
          // 私聊消息
          const userContent = (d.content || '').trim();
          if (userContent) {
            console.log('[MSG] 私聊:', userContent, '来自:', d.author && d.author.user_openid);
            const reply = await callAI(userContent);
            await sendReply('friend', d.author.user_openid, d.id, reply);
          }
        }
        break;

      case 7: // Reconnect
        console.log('[WS] 服务端要求重连');
        ws.close();
        break;

      case 9: // Invalid Session
        console.log('[WS] 无效会话，3秒后重连');
        setTimeout(() => reconnect(gatewayUrl), 3000);
        break;
    }
  });

  ws.on('close', (code, reason) => {
    console.log('[WS] 连接关闭:', code, reason.toString());
    stopHeartbeat();
    reconnect(gatewayUrl);
  });

  ws.on('error', (err) => {
    console.error('[WS] 错误:', err.message);
  });
}

function startHeartbeat(interval) {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: lastSeq }));
    }
  }, interval);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function reconnect(gatewayUrl) {
  reconnectAttempts++;
  const delay = Math.min(reconnectAttempts * 3000, 30000);
  console.log('[WS] 将在', delay / 1000, '秒后重连（第', reconnectAttempts, '次）');
  setTimeout(async () => {
    try {
      await ensureToken();
      const newGateway = await getGateway();
      connectWebSocket(newGateway);
    } catch (e) {
      console.error('[WS] 重连失败:', e.message);
      reconnect(gatewayUrl);
    }
  }, delay);
}

// ===== HTTP 保活（Zeabur需要监听端口） =====
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('anxiaoqi-qqbot is running');
});

server.listen(PORT, () => {
  console.log('[HTTP] 保活服务监听端口:', PORT);
});

// ===== 启动 =====
async function main() {
  console.log('[启动] 安小琪QQ机器人 v1.0');
  console.log('[启动] APP_ID:', config.APP_ID);

  try {
    await ensureToken();
    const gatewayUrl = await getGateway();
    connectWebSocket(gatewayUrl);
  } catch (e) {
    console.error('[启动失败]', e.message);
    setTimeout(main, 5000);
  }
}

main();