/* Service worker - cache do app shell para uso 100% offline
   (só entra em ação quando o app é servido via http/https;
   é ignorado quando o arquivo é aberto direto via file://) */

const CACHE_NAME = "unica-relatorios-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/data.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./vendor/jspdf.umd.min.js"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=> cache.addAll(ASSETS)).then(()=> self.skipWaiting())
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=> k !== CACHE_NAME).map(k=> caches.delete(k)))
    ).then(()=> self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  if(event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached=>{
      if(cached) return cached;
      return fetch(event.request).then(resp=>{
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache=> cache.put(event.request, copy));
        return resp;
      }).catch(()=> cached);
    })
  );
});
