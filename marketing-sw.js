/* Service worker mínimo del panel de marketing: solo existe para que Android ofrezca "Instalar app".
   NO guarda nada en caché ni intercepta nada: el portal siempre pide sus datos y archivos a la red. */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* sin respondWith: el navegador resuelve la petición como siempre */ });
