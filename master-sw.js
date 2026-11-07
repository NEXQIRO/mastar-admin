/* NEXQIRO master panel service worker: install support + নোটিফিকেশনে ক্লিক করলে প্যানেল খোলা (কোনো cache নেই — সবসময় লাইভ ডেটা) */
self.addEventListener('install',function(){self.skipWaiting()});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',function(e){e.respondWith(fetch(e.request))});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  var view=(e.notification.data&&e.notification.data.view)||'reqs';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){var c=list[i];if('focus' in c){c.postMessage({view:view});return c.focus()}}
    return self.clients.openWindow('./');
  }));
});
