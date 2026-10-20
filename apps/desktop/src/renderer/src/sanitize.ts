import DOMPurify, { type Config } from 'dompurify';

/** Each fixed policy owns its instance; parsing a page must not rebuild allowlists per block. */
export function htmlSanitizer(config: Config): (html: string) => string {
  let purifier: ReturnType<typeof DOMPurify> | undefined;
  return (html) => {
    if (!purifier) {
      purifier = DOMPurify(window);
      purifier.setConfig(config);
    }
    return purifier.sanitize(html);
  };
}

/** Reuse the sanitized DOM directly instead of serializing and parsing it for a second time. */
export function fragmentSanitizer(config: Config): (html: string) => DocumentFragment {
  let purifier: ReturnType<typeof DOMPurify> | undefined;
  return (html) => {
    if (!purifier) {
      purifier = DOMPurify(window);
      purifier.setConfig({ ...config, RETURN_DOM_FRAGMENT: true });
    }
    return purifier.sanitize(html) as unknown as DocumentFragment;
  };
}
