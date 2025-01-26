importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBowWu2iQ6dKSfDLafA0KlnPB6q-z-gJdI",
  authDomain: "noandta-28cc8.firebaseapp.com",
  projectId: "noandta-28cc8",
  storageBucket: "noandta-28cc8.firebasestorage.app",
  messagingSenderId: "515095303787",
  appId: "1:515095303787:web:dfa3498698d95ce32d032e"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message:', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/logo192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
