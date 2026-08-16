# Tech Verse Course — সেটআপ গাইড

## ১. Firebase কনফিগার করুন
`js/firebase-config.js` ফাইলের **লাইন ১১-১৮** এ আপনার Firebase প্রজেক্টের config বসান:

```
Firebase Console → প্রজেক্ট তৈরি করুন → Project settings → General → Your apps → Web app যোগ করুন → SDK config কপি করুন
```

Firebase Console-এ চালু করতে হবে:
- **Authentication** → Sign-in method → Email/Password চালু করুন (Google Sign-in চাইলে সেটাও চালু করুন)
- **Firestore Database** → তৈরি করুন (production mode)
- **Storage** → তৈরি করুন (প্রোফাইল ছবি রাখার জন্য)

## ২. Firestore সিকিউরিটি রুলস
Firebase Console → Firestore → Rules ট্যাবে গিয়ে এটি বসান:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }
    function isAdmin() {
      return isSignedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }

    /* ---------- ইউজার প্রোফাইল ---------- */
    match /users/{uid} {
      allow read: if isSignedIn() && (request.auth.uid == uid || isAdmin());

      allow create: if isSignedIn() && request.auth.uid == uid &&
        request.resource.data.isAdmin == false;

      allow update: if isSignedIn() && (
        (request.auth.uid == uid && request.resource.data.isAdmin == resource.data.isAdmin) ||
        isAdmin()
      );

      // নিজের অ্যাকাউন্ট নিজে ডিলিট করতে পারবে (প্রোফাইল পেজের "অ্যাকাউন্ট মুছে ফেলুন"), অ্যাডমিনও যে-কারো ডিলিট করতে পারবে
      allow delete: if isAdmin() || (isSignedIn() && request.auth.uid == uid);
    }

    /* ---------- কোর্স ---------- */
    match /courses/{courseId} {
      allow read: if true;
      allow write: if isAdmin();

      match /lessons/{lessonId} {
        allow read: if true;
        allow write: if isAdmin();
      }
    }

    /* ---------- পরীক্ষা ---------- */
    match /exams/{examId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();

      match /questions/{questionId} {
        allow read: if isSignedIn();
        allow write: if isAdmin();
      }
    }

    /* ---------- পরীক্ষার ফলাফল ---------- */
    // অ্যাডমিন প্যানেলের "Leaderboard" ও "Overview" পেজ সব ইউজারের ফলাফল একসাথে দেখায়,
    // তাই read রুলে `|| isAdmin()` অবশ্যই থাকতে হবে (নিচে আছে) — বাদ দিলে ঐ দুই পেজ ডেটা লোড করতে পারবে না।
    match /results/{resultId} {
      allow read: if isSignedIn() && (resource.data.uid == request.auth.uid || isAdmin());
      allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
      allow update: if isSignedIn() && resource.data.uid == request.auth.uid &&
        request.resource.data.uid == resource.data.uid;
      allow delete: if isAdmin();
    }

    /* ---------- সাইট সেটিংস (হোমপেজ হিরো + ফিচার্ড ভিডিও + পেমেন্ট নাম্বার) ---------- */
    match /settings/{docId} {
      // হোমপেজ সেটিংস সবাই পড়তে পারবে (লগআউট অবস্থাতেও), কিন্তু পেমেন্ট নাম্বার শুধু লগইন করা ইউজার পড়তে পারবে
      allow read: if docId != "payment" || isSignedIn();
      allow write: if isAdmin();
    }

    /* ---------- পেইড কোর্স: ক্রয় অনুরোধ ---------- */
    match /purchaseRequests/{reqId} {
      allow read: if isSignedIn() && (resource.data.uid == request.auth.uid || isAdmin());

      allow create: if isSignedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.status == "pending"
        && request.resource.data.accessCode == "";

      // ইউজার নিজে স্ট্যাটাস/অ্যাক্সেসকোড বদলাতে পারবে না — শুধু অ্যাডমিন অনুমোদন/বাতিল করতে পারবে
      allow update, delete: if isAdmin();
    }

    /* ---------- পেইড কোর্স: অ্যাক্সেস কোড ---------- */
    // ডকুমেন্ট আইডি = নিজেই অ্যাক্সেস কোড (যেমন accessCodes/AB12CD34)
    match /accessCodes/{code} {
      allow read: if isSignedIn() && (resource.data.uid == request.auth.uid || isAdmin());
      allow create: if isAdmin();

      // ইউজার শুধু নিজের, এখনো-ব্যবহার-না-হওয়া কোডটি "used" করতে পারবে — uid/courseId বদলাতে পারবে না
      allow update: if isSignedIn()
        && resource.data.uid == request.auth.uid
        && resource.data.used == false
        && request.resource.data.used == true
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.courseId == resource.data.courseId
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["used", "usedAt"]);

      allow delete: if isAdmin();
    }
  }
}
```
> **নিরাপত্তা নোট:** `users/{uid}` ডকুমেন্টের `enrolledCourses` ফিল্ড ইউজার নিজেই এডিট করতে পারে (এটা আগে থেকেই ছিল, ফ্রি কোর্সের অটো-এনরোলের জন্য দরকার)। তাই লক করা কনটেন্টের প্রকৃত অ্যাক্সেস-নিয়ন্ত্রণ কখনোই `enrolledCourses` দিয়ে করা হয় না — `course.js` এবং `exam.js` সবসময় `accessCodes` কালেকশনে সরাসরি চেক করে (উপরের রুলে এটা কঠোরভাবে সুরক্ষিত), তাই কেউ ব্রাউজার কনসোল দিয়ে নিজের প্রোফাইল এডিট করলেও লকড ভিডিও/পরীক্ষা দেখতে পারবে না।

## ৩. Storage সিকিউরিটি রুলস
Firebase Console → Storage → Rules:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatars/{uid} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## ৪. নিজেকে অ্যাডমিন বানান
১. সাইট থেকে একবার সাইন আপ করুন
২. Firestore Console → `users` কালেকশন → আপনার UID খুঁজুন → `isAdmin` ফিল্ড `true` করে দিন
৩. পেজ রিফ্রেশ দিয়ে সরাসরি `admin.html` এ যান, অথবা নেভবারে/প্রোফাইলে "⚙ অ্যাডমিন" লিংকে ক্লিক করুন — এটি এখন একটি সম্পূর্ণ, আলাদা অ্যাডমিন প্যানেল

## ৫. অ্যাডমিন প্যানেল (`admin.html`)
সাইডবারে ৬টি সেকশন আছে:
- **ওভারভিউ** — মোট কোর্স, লেসন, পরীক্ষা, ইউজার ও সাম্প্রতিক ফলাফলের পরিসংখ্যান
- **হোমপেজ ও ভিডিও** — হিরো সেকশনের লেখা এবং হোমপেজের "স্মার্ট ফিচার্ড ভিডিও" সেকশনে কোন লেসনগুলো দেখাবে তা বাছাই ও ক্রমানুসারে সাজানো (কিছু না বাছাই করলে সবচেয়ে নতুন ভিডিওগুলো এমনিতেই দেখানো হয়)
- **কোর্স** — কোর্স তৈরি, সম্পাদনা, মুছে ফেলা (তালিকা আকারে, সাথে কভার ছবি, লেসন সংখ্যা, মূল্য)
- **লেসন / ভিডিও** — কোর্স বাছাই করে সেই কোর্সের সব ভিডিও/স্লাইড যোগ, সম্পাদনা বা মুছে ফেলা
- **পরীক্ষা** — পরীক্ষা ও প্রশ্ন তৈরি, বিদ্যমান পরীক্ষা সম্পাদনা বা মুছে ফেলা, চাইলে কোনো পেইড কোর্সের সাথে লক করে দেওয়া, এবং প্রতিটি পরীক্ষার জন্য আলাদাভাবে **নেগেটিভ মার্কিং** (ভুল উত্তরে কত মার্ক কাটা যাবে) সেট করা
- **লিডারবোর্ড** — প্রতিটি পরীক্ষার জন্য (অথবা সব পরীক্ষা মিলিয়ে সম্মিলিতভাবে) সব ইউজারের ফলাফল একসাথে র‍্যাঙ্ক করে দেখায়, যাতে কাউকে গিফট দেওয়ার সময় সহজে সিদ্ধান্ত নেওয়া যায়
- **ক্রয় অনুরোধ** — পেমেন্ট নাম্বার সেটিংস + ইউজারদের কোর্স কেনার অনুরোধ অনুমোদন/বাতিল
- **ইউজার** — সব ইউজারের তালিকা, সার্চ, এবং টগল দিয়ে কাউকে অ্যাডমিন বানানো/বাদ দেওয়া

কভার ইমেজ, ভিডিও বা স্লাইড হোস্ট করতে Firebase Storage-এ আপলোড করে সেই লিংক ব্যবহার করতে পারেন, অথবা যেকোনো পাবলিক URL (YouTube লিংক সহ) দিতে পারেন।

## ৬. ডিপ্লয়
Vercel-এ যেকোনো স্ট্যাটিক সাইট হিসেবে ডিপ্লয় করা যাবে (build command দরকার নেই, পুরো ফোল্ডারটাই আপলোড করুন)।

## ৭. পেইড কোর্স ও অ্যাক্সেস কোড সিস্টেম

এই সাইটে এখন কোনো অনলাইন পেমেন্ট গেটওয়ে নেই (bKash/Nagad-এর নিজস্ব API লাগে না) — পুরো প্রসেসটা ম্যানুয়াল ভেরিফিকেশন + ইমেইলে অ্যাক্সেস কোডের মাধ্যমে কাজ করে:

1. **অ্যাডমিন প্যানেল → কোর্স** এ কোনো কোর্স এডিট করে **মূল্য** দিন (০ রাখলে কোর্সটি ফ্রি থাকবে)। চাইলে ডিসকাউন্ট মূল্য এবং "কিভাবে কিনবেন" ভিডিও লিংকও দিতে পারেন।
2. **অ্যাডমিন প্যানেল → ক্রয় অনুরোধ** এ গিয়ে আপনার বিকাশ/নগদ/রকেট নাম্বার সেভ করুন — এগুলো ইউজাররা কেনার সময় দেখবে।
3. ইউজার কোর্স পেজে গিয়ে মূল্য ও প্রিভিউ ভিডিও দেখবে, "কোর্সটি কিনতে চাই" বাটনে ক্লিক করে নাম/ফোন/পেমেন্ট মাধ্যম/পাঠানো টাকার পরিমাণ দিয়ে ফর্ম সাবমিট করবে (এর আগে অবশ্যই সাইন আপ/লগইন করা থাকতে হবে)।
4. এই অনুরোধটি **অ্যাডমিন প্যানেল → ক্রয় অনুরোধ** এ দেখা যাবে। টাকা পাওয়ার পর ✓ বাটনে ক্লিক করলে:
   - একটা র‍্যান্ডম ৮-ক্যারেক্টার অ্যাক্সেস কোড তৈরি হয়
   - কোডটা `accessCodes` কালেকশনে সেভ হয় (ওই নির্দিষ্ট ইউজার ও কোর্সের জন্য, একবার ব্যবহারযোগ্য)
   - EmailJS দিয়ে ইউজারের ইমেইলে কোডটা পাঠানো হয়
5. ইউজার কোর্স পেজে ফিরে এসে "অ্যাক্সেস কোড দিয়ে আনলক করুন" বক্সে কোডটি বসালে কোর্সের সব ভিডিও/স্লাইড এবং সেই কোর্সের সাথে যুক্ত পরীক্ষা আনলক হয়ে যায়।
6. ✗ বাটনে ক্লিক করে অনুরোধ বাতিলও করা যায় — ইউজার তখন তথ্য ঠিক করে আবার অনুরোধ পাঠাতে পারবে।

**পরীক্ষাকেও কোর্সের সাথে লক করতে:** অ্যাডমিন প্যানেল → পরীক্ষা → এডিট করার সময় "সংশ্লিষ্ট কোর্স" ড্রপডাউন থেকে কোর্সটি বেছে নিন। কোর্সটি পেইড হলে, শুধু যারা সেই কোর্স আনলক করেছেন তারাই পরীক্ষাটি দেখতে/দিতে পারবেন।

### EmailJS সেটআপ (ইমেইল পাঠানোর জন্য)

1. [emailjs.com](https://www.emailjs.com) এ ফ্রি অ্যাকাউন্ট খুলুন।
2. **Email Services** → একটা সার্ভিস যোগ করুন (Gmail দিয়ে সহজে করা যায়) → এর **Service ID** কপি করুন।
3. **Email Templates** → নতুন টেমপ্লেট তৈরি করুন — নিচে দেওয়া টেমপ্লেট কনটেন্ট ব্যবহার করতে পারেন। টেমপ্লেট সেভ করার পর এর **Template ID** কপি করুন।
4. **Account → General** থেকে আপনার **Public Key** কপি করুন।
5. `admin.html` ফাইলে `YOUR_EMAILJS_PUBLIC_KEY` বসান।
6. `js/admin.js` ফাইলের একদম নিচের দিকে `EMAILJS_SERVICE_ID` এবং `EMAILJS_TEMPLATE_ID` এ যথাক্রমে আপনার Service ID ও Template ID বসান।

> EmailJS ফ্রি প্ল্যানে মাসে ২০০টি ইমেইল পাঠানো যায় — এই সাইজের সাইটের জন্য যথেষ্ট। এটা সম্পূর্ণ ব্রাউজার থেকেই কাজ করে, কোনো ব্যাকএন্ড/সার্ভার লাগে না, তাই খরচও নেই।

## ফাইল স্ট্রাকচার
```
index.html      — হোম/কোর্স তালিকা
login.html      — লগইন
signup.html     — সাইন আপ
course.html     — ভিডিও + স্লাইড ভিউয়ার
exam.html       — পরীক্ষার তালিকা ও পরীক্ষা দেওয়া
profile.html    — প্রোফাইল, আমার কোর্স, ফলাফল
admin.html      — সম্পূর্ণ অ্যাডমিন প্যানেল (কোর্স, লেসন/ভিডিও, পরীক্ষা, ইউজার, হোমপেজ)
css/            — প্রতিটি পেজের আলাদা স্টাইল ফাইল
js/             — প্রতিটি পেজের লজিক + firebase-config.js + utils.js
manifest.json   — PWA ম্যানিফেস্ট
sw.js           — অফলাইন ক্যাশিং সার্ভিস ওয়ার্কার
```
