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
