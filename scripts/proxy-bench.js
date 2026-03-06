#!/usr/bin/env node

import net from 'node:net';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const defaults = {
    protocol: 'http',
    proxyHost: '127.0.0.1',
    proxyPort: 7890,
    authUser: '',
    authPass: '',
    timeoutMs: 5000,
    connectConcurrency: 80,
    throughputConnections: 24,
    throughputSeconds: 12,
    payloadBytes: 32 * 1024,
    burstTotal: 600,
    burstConcurrency: 100,
    burstAbruptRatio: 0.35,
    echoHost: '127.0.0.1',
    output: 'pretty',
    runId: `proxy-bench-${Date.now()}`,
  };

  const args = { ...defaults };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }

  args.protocol = String(args.protocol).toLowerCase();
  args.proxyPort = Number(args.proxyPort);
  args.timeoutMs = Number(args.timeoutMs);
  args.connectConcurrency = Number(args.connectConcurrency);
  args.throughputConnections = Number(args.throughputConnections);
  args.throughputSeconds = Number(args.throughputSeconds);
  args.payloadBytes = Number(args.payloadBytes);
  args.burstTotal = Number(args.burstTotal);
  args.burstConcurrency = Number(args.burstConcurrency);
  args.burstAbruptRatio = Number(args.burstAbruptRatio);

  if (!['http', 'socks5'].includes(args.protocol)) {
    throw new Error(`unsupported protocol: ${args.protocol}`);
  }
  if (!Number.isInteger(args.proxyPort) || args.proxyPort <= 0) {
    throw new Error('proxyPort must be > 0');
  }
  if (args.timeoutMs <= 0) {
    throw new Error('timeoutMs must be > 0');
  }
  return args;
}

function onceEvent(emitter, event) {
  return new Promise((resolve) => {
    emitter.once(event, resolve);
  });
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('connect timeout'));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function readExactly(socket, size, timeoutMs) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let total = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('read timeout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('socket closed'));
    }

    function onData(chunk) {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= size) {
        cleanup();
        const merged = Buffer.concat(chunks, total);
        const head = merged.subarray(0, size);
        const rest = merged.subarray(size);
        if (rest.length > 0) {
          socket.pause();
          socket.unshift(rest);
          socket.resume();
        }
        resolve(head);
      }
    }

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function readUntil(socket, marker, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let total = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('read timeout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('socket closed'));
    }

    function onData(chunk) {
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBytes) {
        cleanup();
        reject(new Error('header too large'));
        return;
      }
      const merged = Buffer.concat(chunks, total);
      const idx = merged.indexOf(marker);
      if (idx >= 0) {
        cleanup();
        const headEnd = idx + marker.length;
        const head = merged.subarray(0, headEnd);
        const rest = merged.subarray(headEnd);
        if (rest.length > 0) {
          socket.pause();
          socket.unshift(rest);
          socket.resume();
        }
        resolve(head);
      }
    }

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function httpConnect(proxyHost, proxyPort, targetHost, targetPort, timeoutMs, auth) {
  const socket = await connectTcp(proxyHost, proxyPort, timeoutMs);
  const authHeader = auth.user
    ? `Proxy-Authorization: Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}\r\n`
    : '';
  const req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n${authHeader}\r\n`;
  socket.write(req);
  const res = await readUntil(socket, Buffer.from('\r\n\r\n'), 32 * 1024, timeoutMs);
  const firstLine = res.toString('utf8').split('\r\n')[0] || '';
  if (!firstLine.includes(' 200 ')) {
    socket.destroy();
    throw new Error(`http connect failed: ${firstLine}`);
  }
  return socket;
}

function hostToSocksAddr(host) {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(host)) {
    const octets = host.split('.').map((v) => Number(v));
    if (octets.every((v) => v >= 0 && v <= 255)) {
      return Buffer.from([0x01, ...octets]);
    }
  }
  const hostBuf = Buffer.from(host, 'utf8');
  return Buffer.concat([Buffer.from([0x03, hostBuf.length]), hostBuf]);
}

async function socks5Connect(proxyHost, proxyPort, targetHost, targetPort, timeoutMs, auth) {
  const socket = await connectTcp(proxyHost, proxyPort, timeoutMs);

  if (auth.user) {
    socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
  } else {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
  }
  const methodResp = await readExactly(socket, 2, timeoutMs);
  if (methodResp[0] !== 0x05) {
    socket.destroy();
    throw new Error('invalid socks5 version');
  }
  if (methodResp[1] === 0xff) {
    socket.destroy();
    throw new Error('no acceptable socks5 auth method');
  }
  if (methodResp[1] === 0x02) {
    const userBuf = Buffer.from(auth.user, 'utf8');
    const passBuf = Buffer.from(auth.pass, 'utf8');
    const req = Buffer.concat([
      Buffer.from([0x01, userBuf.length]),
      userBuf,
      Buffer.from([passBuf.length]),
      passBuf,
    ]);
    socket.write(req);
    const authResp = await readExactly(socket, 2, timeoutMs);
    if (authResp[1] !== 0x00) {
      socket.destroy();
      throw new Error('socks5 auth failed');
    }
  }

  const addr = hostToSocksAddr(targetHost);
  const port = Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]);
  const connectReq = Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addr, port]);
  socket.write(connectReq);
  const head = await readExactly(socket, 4, timeoutMs);
  if (head[1] !== 0x00) {
    socket.destroy();
    throw new Error(`socks5 connect failed rep=${head[1]}`);
  }
  if (head[3] === 0x01) {
    await readExactly(socket, 4 + 2, timeoutMs);
  } else if (head[3] === 0x03) {
    const len = await readExactly(socket, 1, timeoutMs);
    await readExactly(socket, len[0] + 2, timeoutMs);
  } else if (head[3] === 0x04) {
    await readExactly(socket, 16 + 2, timeoutMs);
  }
  return socket;
}

async function establishProxyTunnel(args, targetHost, targetPort) {
  const auth = { user: args.authUser || '', pass: args.authPass || '' };
  if (args.protocol === 'http') {
    return httpConnect(
      args.proxyHost,
      args.proxyPort,
      targetHost,
      targetPort,
      args.timeoutMs,
      auth,
    );
  }
  return socks5Connect(
    args.proxyHost,
    args.proxyPort,
    targetHost,
    targetPort,
    args.timeoutMs,
    auth,
  );
}

function createEchoServer(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.pipe(socket);
    });
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      resolve({ server, host, port: addr.port });
    });
  });
}

async function exchangeOnce(socket, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('exchange timeout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('socket closed'));
    }

    function onData(chunk) {
      received += chunk.length;
      if (received >= payload.length) {
        cleanup();
        resolve(payload.length);
      }
    }

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.write(payload);
  });
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[idx].toFixed(2));
}

async function runConnectPhase(args, targetHost, targetPort) {
  const latencies = [];
  let success = 0;
  let failed = 0;

  await Promise.all(
    Array.from({ length: args.connectConcurrency }, async () => {
      const start = performance.now();
      try {
        const socket = await establishProxyTunnel(args, targetHost, targetPort);
        latencies.push(performance.now() - start);
        const ping = Buffer.from('ping');
        await exchangeOnce(socket, ping, args.timeoutMs);
        socket.end();
        success += 1;
      } catch (err) {
        failed += 1;
      }
    }),
  );

  return {
    concurrency: args.connectConcurrency,
    success,
    failed,
    connectP50Ms: percentile(latencies, 50),
    connectP95Ms: percentile(latencies, 95),
    connectP99Ms: percentile(latencies, 99),
  };
}

async function runThroughputPhase(args, targetHost, targetPort) {
  const payload = crypto.randomBytes(args.payloadBytes);
  const endAt = Date.now() + args.throughputSeconds * 1000;
  let bytesSent = 0;
  let bytesRecv = 0;
  let loops = 0;
  let failed = 0;

  await Promise.all(
    Array.from({ length: args.throughputConnections }, async () => {
      let socket;
      try {
        socket = await establishProxyTunnel(args, targetHost, targetPort);
        while (Date.now() < endAt) {
          const n = await exchangeOnce(socket, payload, args.timeoutMs);
          bytesSent += n;
          bytesRecv += n;
          loops += 1;
        }
        socket.end();
      } catch (err) {
        failed += 1;
        if (socket) {
          socket.destroy();
        }
      }
    }),
  );

  const seconds = args.throughputSeconds;
  const mbpsOut = Number(((bytesSent * 8) / (seconds * 1024 * 1024)).toFixed(2));
  const mbpsIn = Number(((bytesRecv * 8) / (seconds * 1024 * 1024)).toFixed(2));

  return {
    seconds,
    connections: args.throughputConnections,
    payloadBytes: args.payloadBytes,
    loops,
    failed,
    bytesSent,
    bytesRecv,
    mbpsOut,
    mbpsIn,
  };
}

async function mapLimit(total, limit, taskFactory) {
  let idx = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= total) {
        return;
      }
      await taskFactory(current);
    }
  });
  await Promise.all(workers);
}

async function runBurstPhase(args, targetHost, targetPort) {
  const payload = Buffer.from('burst-check');
  let success = 0;
  let failed = 0;
  let abruptClosed = 0;

  await mapLimit(args.burstTotal, args.burstConcurrency, async () => {
    let socket;
    try {
      socket = await establishProxyTunnel(args, targetHost, targetPort);
      const abrupt = Math.random() < args.burstAbruptRatio;
      if (abrupt) {
        abruptClosed += 1;
        socket.destroy();
        success += 1;
        return;
      }
      await exchangeOnce(socket, payload, args.timeoutMs);
      socket.end();
      success += 1;
    } catch (err) {
      failed += 1;
      if (socket) {
        socket.destroy();
      }
    }
  });

  return {
    total: args.burstTotal,
    concurrency: args.burstConcurrency,
    abruptRatio: args.burstAbruptRatio,
    abruptClosed,
    success,
    failed,
  };
}

function printResult(result, output) {
  if (output === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const echo = await createEchoServer(args.echoHost);

  try {
    const connect = await runConnectPhase(args, echo.host, echo.port);
    const throughput = await runThroughputPhase(args, echo.host, echo.port);
    const burst = await runBurstPhase(args, echo.host, echo.port);

    const result = {
      kind: 'proxy-benchmark-v1',
      runId: args.runId,
      startedAt,
      endedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
      },
      target: {
        protocol: args.protocol,
        proxyHost: args.proxyHost,
        proxyPort: args.proxyPort,
        authEnabled: Boolean(args.authUser),
      },
      phases: {
        connect,
        throughput,
        burst,
      },
    };

    printResult(result, args.output);
  } finally {
    echo.server.close();
    await onceEvent(echo.server, 'close');
  }
}

main().catch((err) => {
  process.stderr.write(`proxy-bench failed: ${err.message}\n`);
  process.exit(1);
});
