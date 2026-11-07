#!/usr/bin/env node
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { createGateway, issueToken, openStore } from './gateway.mjs';
const [command, ...args] = process.argv.slice(2);
if (command === 'token') {
  if (!process.env.FEEDBACK_SECRET || !args[0] || !args[1]) throw Error('FEEDBACK_SECRET=… node cli.mjs token APP SUBJECT');
  console.log(issueToken(process.env.FEEDBACK_SECRET, args[0], args[1]));
} else if (command === 'serve') {
  const config = JSON.parse(readFileSync(args[0] || 'feedback.config.json', 'utf8'));
  const path = config.database || './private/feedback.sqlite';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = openStore(path); chmodSync(path, 0o600);
  const handler = createGateway({ db, apps: config.apps, squircleURL: config.squircleURL,
    secret: process.env.FEEDBACK_SECRET, adminToken: process.env.FEEDBACK_ADMIN_TOKEN,
    controlToken: process.env.SQUIRCLE_CONTROL_TOKEN });
  createServer(handler).listen(config.port || 8787, config.host || '127.0.0.1', () => console.log('Feedback gateway ready'));
} else {
  console.log('Usage: node cli.mjs serve [config.json]\n       node cli.mjs token APP SUBJECT\nRequired server env: FEEDBACK_SECRET, FEEDBACK_ADMIN_TOKEN, SQUIRCLE_CONTROL_TOKEN');
  process.exitCode = command ? 1 : 0;
}
