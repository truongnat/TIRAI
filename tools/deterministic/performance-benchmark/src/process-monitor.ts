import { readFileSync } from 'node:fs';
export interface ProcessMetrics { rssBytes?: number; cpuUserMs?: number; cpuSystemMs?: number; }
function linuxMetrics(pid: number): ProcessMetrics {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8'); const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const hz = 100; const utime = Number(tail[11]); const stime = Number(tail[12]);
    return { rssBytes: rss ? Number(rss[1]) * 1024 : undefined, cpuUserMs: utime * 1000 / hz, cpuSystemMs: stime * 1000 / hz };
  } catch { return {}; }
}
export function readProcessMetrics(pid: number): ProcessMetrics { if (process.platform === 'linux') return linuxMetrics(pid); return {}; }
export class ProcessSampler {
  private timer: NodeJS.Timeout | undefined; private peakRssBytes = 0; private last: ProcessMetrics = {};
  constructor(private readonly pid: number, private readonly intervalMs: number) {}
  start(): void { this.sample(); this.timer = setInterval(() => this.sample(), this.intervalMs); }
  private sample(): void { this.last = readProcessMetrics(this.pid); if ((this.last.rssBytes ?? 0) > this.peakRssBytes) this.peakRssBytes = this.last.rssBytes ?? 0; }
  stop(): ProcessMetrics { if (this.timer) clearInterval(this.timer); this.sample(); return { ...this.last, rssBytes: this.peakRssBytes || this.last.rssBytes }; }
}
