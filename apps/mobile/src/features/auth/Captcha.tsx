/**
 * Bot protection for email sign-in and sign-up: a Cloudflare Turnstile check
 * whose one-time token Supabase Auth verifies with the secret key. Shown only
 * when EXPO_PUBLIC_TURNSTILE_SITE_KEY is set; Supabase Auth must then have
 * CAPTCHA protection on (Deploy backend turns it on when the
 * TURNSTILE_SECRET_KEY secret exists). Most people never see a puzzle:
 * Turnstile decides in the background and shows a checkbox only when unsure.
 *
 * The widget runs in a WebView whose page claims the Supabase project's
 * hostname, which must be listed under the Turnstile widget's hostnames.
 */

import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { env, supabaseHost } from '@/config/env';
import { Caption } from '@/ui/components';
import { colors } from '@/ui/theme';

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

function widgetHtml(siteKey: string): string {
  // JSON with `<` escaped: safe to embed in a script element.
  const key = JSON.stringify(siteKey).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:${colors.surface};}</style>
<script src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js?onload=matiqReady&render=explicit" async defer></script>
</head><body><div id="check"></div><script>
function post(message){window.ReactNativeWebView.postMessage(JSON.stringify(message));}
function matiqReady(){
  turnstile.render('#check',{sitekey:${key},theme:'dark',size:'flexible',language:'auto',
    callback:function(token){post({type:'token',token:token});},
    'expired-callback':function(){post({type:'expired'});},
    'error-callback':function(){post({type:'error'});return true;}});
}
</script></body></html>`;
}

export interface Captcha {
  /** False when bot protection is off for this build. */
  enabled: boolean;
  /** One-time token for the next Auth request, or undefined. */
  token: string | undefined;
  /** Tokens are single-use: call after every Auth request. */
  reset: () => void;
  element: ReactNode;
}

export function useCaptcha(): Captcha {
  const siteKey = env.turnstileSiteKey;
  const [token, setToken] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const html = useMemo(() => (siteKey ? widgetHtml(siteKey) : ''), [siteKey]);

  const reset = useCallback(() => {
    setToken(undefined);
    setFailed(false);
    setGeneration((value) => value + 1);
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; token?: unknown };
      if (message.type === 'token' && typeof message.token === 'string' && message.token.length < 4096) {
        setToken(message.token);
        setFailed(false);
      } else if (message.type === 'expired') {
        setToken(undefined);
      } else if (message.type === 'error') {
        setToken(undefined);
        setFailed(true);
      }
    } catch {
      // Ignore anything that isn't a widget message.
    }
  }, []);

  if (!siteKey) return { enabled: false, token: undefined, reset, element: null };

  const element = (
    <View accessible={false} style={styles.wrapper}>
      <View accessibilityLabel="Security check" style={styles.frame}>
        <WebView
          key={generation}
          source={{ html, baseUrl: `https://${supabaseHost}` }}
          originWhitelist={['https://*']}
          onMessage={onMessage}
          // Only the page itself and Cloudflare's challenge may load.
          onShouldStartLoadWithRequest={(request) =>
            request.url === 'about:blank' || request.url.startsWith(TURNSTILE_ORIGIN) || request.url.startsWith(`https://${supabaseHost}`)
          }
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          scrollEnabled={false}
          style={styles.webview}
        />
      </View>
      {failed ? <Caption>The security check didn't load. Check your connection, then try again.</Caption> : null}
    </View>
  );
  return { enabled: true, token, reset, element };
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  frame: { height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  webview: { flex: 1, backgroundColor: colors.surface },
});
