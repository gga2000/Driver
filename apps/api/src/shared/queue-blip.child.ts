/**
 * Child process for queue.redis.test.ts: a `worker` process with busy queues on REDIS_URL. It prints
 * `beat` every 100 ms (a frozen event loop stops them) and `ran <id>` for every job it finishes.
 */
import { BullMqQueueFactory } from './queue.js';

const [url, prefix, queues] = [process.env['REDIS_URL'], process.env['BLIP_PREFIX'] ?? 'blip', Number(process.env['BLIP_QUEUES'] ?? 4)];
const factory = new BullMqQueueFactory(url, prefix, 'worker');
for (let k = 0; k < queues; k++) {
  factory.queue(`busy${k}`).process(async (job) => {
    await new Promise((r) => setTimeout(r, 10));
    process.stdout.write(`ran ${job.id}\n`);
  });
}
setInterval(() => process.stdout.write('beat\n'), 100);
process.on('SIGTERM', () => process.exit(0));
