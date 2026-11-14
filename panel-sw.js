/* Service worker mínimo del panel de pedidos: solo existe para que Android ofrezca "Instalar app".
   NO guarda nada en caché ni intercepta nada: el panel siempre pide sus datos y archivos a la red. */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* sin respondWith: el navegador resuelve la petición como siempre */ });
