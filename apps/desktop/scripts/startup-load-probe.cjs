/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Included before generated requires. Enabled only for real startup diagnostics.
if (process.env.SKARO_LOAD_TRACE) {
  (() => {
    const entry = performance.now();
    performance.mark('skaro:entry', { startTime: entry });
    const Module = require('node:module');
    const fs = require('node:fs');
    const original = Module._load;
    const originalResolve = Module._resolveFilename;
    const originalRead = fs.readFileSync;
    const records = [];
    const resolutions = [];
    const reads = [];
    const stack = [];
    const probe = {
      entry,
      timeOrigin: performance.timeOrigin,
      uptime: process.uptime(),
      records,
      resolutions,
      reads,
      stop() {
        Module._load = original;
        Module._resolveFilename = originalResolve;
        fs.readFileSync = originalRead;
        performance.mark('skaro:entry evaluated');
      },
    };
    globalThis[Symbol.for('skaro.startupLoads')] = probe;
    Module._resolveFilename = function (...args) {
      const start = performance.now();
      try {
        return originalResolve.apply(this, args);
      } finally {
        resolutions.push({ request: args[0], duration: performance.now() - start });
      }
    };
    fs.readFileSync = function (...args) {
      const start = performance.now();
      try {
        return originalRead.apply(this, args);
      } finally {
        reads.push({ path: String(args[0]), duration: performance.now() - start });
      }
    };
    Module._load = function (request, parent, isMain) {
      const frame = { children: 0 };
      stack.push(frame);
      const start = performance.now();
      const cpu = process.cpuUsage();
      try {
        return original.call(this, request, parent, isMain);
      } finally {
        const duration = performance.now() - start;
        const used = process.cpuUsage(cpu);
        stack.pop();
        if (stack.length) stack[stack.length - 1].children += duration;
        records.push({
          request,
          parent: parent?.filename,
          start,
          duration,
          self: duration - frame.children,
          cpu: (used.user + used.system) / 1000,
        });
      }
    };
  })();
}
