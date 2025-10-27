#!/usr/bin/env node
import process from 'process';

async function askHidden(prompt) {
  process.stdout.write(prompt);
  return await new Promise((resolve) => {
    const chunks = [];
    const onData = (data) => {
      const char = data.toString();
      if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (char === '\r' || char === '\n') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        resolve(chunks.join('').trim());
        return;
      }
      if (char === '\u007F') {
        chunks.pop();
        return;
      }
      chunks.push(char);
    };
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('data', onData);
  });
}

async function main() {
  console.log('Telegram smoke test — credentials never stored.');
  const botToken = await askHidden('BOT_TOKEN: ');
  if (!botToken) {
    console.error('BOT_TOKEN missing, aborting.');
    process.exit(1);
  }
  const chatId = await askHidden('CHAT_ID: ');
  if (!chatId) {
    console.error('CHAT_ID missing, aborting.');
    process.exit(1);
  }
  const message = 'Condo Hunt test message — hello from scripts/tools/test_telegram.js';

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
    });
    const json = await res.json();
    if (!json.ok) {
      console.error('Telegram error:', JSON.stringify(json));
      process.exitCode = 1;
      return;
    }
    console.log('Telegram ping sent ✅');
  } catch (error) {
    console.error('Telegram request failed:', error.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Unexpected failure:', error.message);
  process.exitCode = 1;
});
