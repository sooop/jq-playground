/**
 * Ambient type declarations for jq-web loaded via CDN script tag.
 * Covers both jq-web 0.5.x (window.jq.promised) and 0.6.x (window.jq as Promise).
 */

export interface JqInstance {
  json(input: unknown, filter: string): unknown;
  raw(input: string, filter: string): string;
}

interface JqGlobal extends Promise<JqInstance> {
  /** jq-web 0.5.x compat */
  promised?: Promise<JqInstance>;
}

declare global {
  interface Window {
    jq: JqGlobal;
  }
}

export {};
