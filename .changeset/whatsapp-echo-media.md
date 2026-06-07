---
'@vobase/core': patch
---

fix(whatsapp): pre-fetch media for coexistence `smb_message_echoes` so app-sent media attaches

The webhook media pre-fetch only scanned `change.value.messages`, never `change.value.message_echoes`, so media the business sends from the WhatsApp Business App (coexistence) was never downloaded — `parseWhatsAppEchoes` got a cache miss and the echo event carried no `media[]`, rendering as an unavailable attachment. The pre-fetch now also scans `message_echoes[]`, so app-sent images/videos/documents/voice notes attach like inbound media.
