/**
 * Paylaşılan HTTP akış-hijyeni yardımcıları.
 *
 * Resmî kaynak okuyucularının tamamı (haber, takvim, tercih, kitapçık, YÖK
 * Atlas) gövdeyi tüketmeden fırlatan her yolda bağlantıyı iptal etmek zorunda —
 * aksi hâlde soket/stream süreç sonuna kadar askıda kalır.
 */

/**
 * Yanıt gövdesini sessizce iptal eder.
 *
 * try/catch süs değil taşıyıcıdır: `reader.cancel()` sonrasında
 * `response.body.cancel()` "ReadableStream is locked" fırlatır; redirect veya
 * hata yolunda bağlantı zaten kapanmış da olabilir. Her iki durum da burada
 * hata değildir.
 */
export async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Gövde kilitli (reader alınmış) ya da bağlantı kapalı — ikisi de normal.
  }
}

/**
 * İlan edilen Content-Length'i sıkı biçim denetimiyle doğrular.
 *
 * Başlık yoksa sessizce geçer (akış tavanı ayrıca uygulanır). Biçimi bozuk
 * (RFC 9112 §6.2'ye göre yalnız rakam dizisi geçerlidir; "12, 12" gibi
 * birleştirilmiş çift başlıklar istek-kaçakçılığı sinyalidir) ya da tavandan
 * büyükse gövdeyi iptal edip fırlatır — fail-closed, §9.1 ile uyumlu.
 */
/**
 * Geçici ağ hatalarına karşı işlemi bekleyip yeniden dener.
 *
 * Deneme, tek tek fetch çağrıları yerine işlemin tamamını sarar: her deneme
 * kendi AbortSignal.timeout'unu sıfırdan kurar (aynı sinyal ikinci denemede
 * çoktan abort olmuş olurdu). GitHub runner'larından ÖSYM'ye tek bağlantı
 * zaman aşımı (UND_ERR_CONNECT_TIMEOUT) bütün cron döngüsünü düşürmesin diye
 * var; kalıcı hatalar tüm denemeler tükendikten sonra aynen fırlatılır.
 */
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000];

export async function withTransientRetries<T>(
  operation: () => Promise<T>,
  options: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? TRANSIENT_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    if (attempt > 0) await sleep(delaysMs[attempt - 1]!);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function assertDeclaredContentLength(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<void> {
  const header = response.headers.get('content-length');
  if (header === null) return;
  if (!/^\d+$/.test(header)) {
    await cancelBody(response);
    throw new Error(`${label} has an invalid Content-Length header: ${header}`);
  }
  if (Number(header) > maxBytes) {
    await cancelBody(response);
    throw new Error(`${label} exceeds the ${maxBytes}-byte safety limit (advertised length).`);
  }
}
