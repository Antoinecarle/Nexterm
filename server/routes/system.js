const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const router = express.Router();

function getCpuUsage() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/);
    const idle = parseInt(stat[4]);
    const total = stat.slice(1, 8).reduce((a, b) => a + parseInt(b), 0);
    return { idle, total };
  } catch {
    return null;
  }
}

let prevCpu = getCpuUsage();

router.get('/info', (req, res) => {
  try {
    // CPU
    const currCpu = getCpuUsage();
    let cpuPercent = 0;
    if (prevCpu && currCpu) {
      const idleDiff = currCpu.idle - prevCpu.idle;
      const totalDiff = currCpu.total - prevCpu.total;
      cpuPercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
      prevCpu = currCpu;
    }

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Disk
    let disk = { total: 0, used: 0, available: 0, percent: 0 };
    try {
      const df = execSync('df -B1 / 2>/dev/null').toString().split('\n')[1].split(/\s+/);
      disk = {
        total: parseInt(df[1]),
        used: parseInt(df[2]),
        available: parseInt(df[3]),
        percent: parseInt(df[4])
      };
    } catch {}

    // Uptime
    const uptimeSec = os.uptime();
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const uptime = `${days}d ${hours}h ${mins}m`;

    // Load average
    const loadAvg = os.loadavg();

    // Hostname
    const hostname = os.hostname();

    // OS info
    const platform = `${os.type()} ${os.release()}`;

    res.json({
      cpu: { percent: cpuPercent, cores: os.cpus().length },
      memory: { total: totalMem, used: usedMem, free: freeMem, percent: Math.round((usedMem / totalMem) * 100) },
      disk,
      uptime,
      loadAvg: loadAvg.map(l => l.toFixed(2)),
      hostname,
      platform
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/processes', (req, res) => {
  try {
    const ps = execSync('ps aux --sort=-%mem 2>/dev/null | head -16').toString();
    const lines = ps.trim().split('\n');
    const headers = lines[0].split(/\s+/);
    const processes = lines.slice(1).map(line => {
      const parts = line.split(/\s+/);
      return {
        user: parts[0],
        pid: parts[1],
        cpu: parts[2],
        mem: parts[3],
        vsz: parts[4],
        rss: parts[5],
        command: parts.slice(10).join(' ')
      };
    });
    res.json(processes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
