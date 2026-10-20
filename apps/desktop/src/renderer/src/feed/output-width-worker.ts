import { workerTextMetrics, type TextMetricsStyle } from './text-fonts';
let measure: ReturnType<typeof workerTextMetrics> | undefined;
self.onmessage = async (event: MessageEvent<{ text: string; style: TextMetricsStyle }>) => {
  try {
    const request = event.data;
    const widthOf = await (measure ??= workerTextMetrics(request.style));
    let width = 0;
    for (const line of request.text.split(/\r\n?|\n/)) width = Math.max(width, widthOf(line));
    self.postMessage({ width });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
