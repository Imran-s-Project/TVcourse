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

      /* ---------- ইউজারের ডিভাইস তালিকা (কোন কোন ফোন/ব্রাউজার থেকে লগইন/সাইন-আপ হয়েছে) ---------- */
      match /devices/{deviceId} {
        // নিজের ডিভাইস তালিকা নিজে পড়তে পারবে, অ্যাডমিনও যে-কারো ডিভাইস তালিকা পড়তে পারবে (ওয়ার্নিং দেখানোর জন্য)
        allow read: if isSignedIn() && (request.auth.uid == uid || isAdmin());

        // লগইন/সাইন-আপের সময় ইউজার নিজেই নিজের ডিভাইস রেকর্ড লিখবে (auth.js এর recordDeviceLogin ফাংশন)
        allow create, update: if isSignedIn() && request.auth.uid == uid;

        allow delete: if isAdmin();
      }

      /* ---------- Learning Hub: এই ইউজারের ফ্ল্যাশকার্ড রিভিউ প্রোগ্রেস (স্পেসড রিপিটিশন) ----------
         শুধু নিজের প্রোগ্রেস নিজে পড়তে/লিখতে পারবে — অন্য কারো রিভিউ শিডিউল কেউ দেখতে/বদলাতে পারবে না। */
      match /flashcardProgress/{cardId} {
        allow read, write: if isSignedIn() && request.auth.uid == uid;
      }
    }

    /* ---------- কোর্স ---------- */
    match /courses/{courseId} {
      allow read: if true;
      allow write: if isAdmin();

      // সাইন-ইন করা যেকোনো ইউজার এনরোল হওয়ার সময় শুধু enrollCount সংখ্যাটা বাড়াতে পারবে —
      // বাকি কোনো ফিল্ড বদলাতে পারবে না (কোর্সের তথ্য সুরক্ষিত থাকে, শুধু গণনা বাড়ে)
      allow update: if isSignedIn()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["enrollCount"])
        && request.resource.data.enrollCount ==
           (("enrollCount" in resource.data ? resource.data.enrollCount : 0) + 1);

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
    match /results/{resultId} {
      allow read: if isSignedIn() && (resource.data.uid == request.auth.uid || isAdmin());
      allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
      allow update: if isSignedIn() && resource.data.uid == request.auth.uid &&
        request.resource.data.uid == resource.data.uid;
      allow delete: if isAdmin();
    }

    /* ---------- সাইট সেটিংস (হোমপেজ হিরো + ফিচার্ড ভিডিও + পেমেন্ট নাম্বার + পারচেজ পজ সুইচ) ----------
       docId "homepage", "purchases" ইত্যাদি সবাই পড়তে পারবে (লগআউট অবস্থাতেও),
       শুধু "payment" (পেমেন্ট নাম্বার) পড়তে লগইন লাগবে — বাকি সব নিচের একই rule কভার করে। */
    match /settings/{docId} {
      allow read: if docId != "payment" || isSignedIn();
      allow write: if isAdmin();
    }

    /* ---------- নোটিফিকেশন (অ্যাডমিন প্যানেল থেকে পাঠানো, কোর্স-ট্যাগসহ) ----------
       শুধু অ্যাডমিন লিখতে/এডিট/ডিলিট করতে পারবে। যেকোনো লগইন করা ইউজার সবগুলো ডকুমেন্ট
       পড়তে পারবে (কোনটা আসলে দেখানো হবে তা client-side এ audience/enrolledCourses
       দিয়ে ফিল্টার হয় — js/notifications.js), তাই read এখানে খোলা রাখা নিরাপদ, কারণ
       ভেতরের কোনো তথ্যই sensitive না (শুধু টাইটেল/মেসেজ/কোর্স-ট্যাগ/কাস্টম লিংক/পিন)।
       create/update এ স্ট্রং ভ্যালিডেশন: টাইটেল/মেসেজ খালি রাখা যাবে না,
       audience অবশ্যই "all" বা "enrolled" হতে হবে, courseIds/courseTitles অবশ্যই list হতে হবে। */
    match /notifications/{notifId} {
      allow read: if isSignedIn();

      allow create: if isAdmin()
        && request.resource.data.title is string && request.resource.data.title.size() > 0
        && request.resource.data.message is string && request.resource.data.message.size() > 0
        && request.resource.data.audience in ["all", "enrolled"]
        && request.resource.data.courseIds is list
        && request.resource.data.courseTitles is list;

      allow update: if isAdmin()
        && request.resource.data.title is string && request.resource.data.title.size() > 0
        && request.resource.data.message is string && request.resource.data.message.size() > 0
        && request.resource.data.audience in ["all", "enrolled"];

      allow delete: if isAdmin();
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

    /* ---------- Learning Hub: স্পেসড-রিপিটিশন ফ্ল্যাশকার্ড (অ্যাডমিন তৈরি করে) ----------
       সব সাইন-ইন করা ইউজার পড়তে পারবে (কোন কার্ড আসলে দেখানো হবে তা client-side এ
       courseId/enrolledCourses দিয়ে ফিল্টার হয় — js/flashcards.js), শুধু অ্যাডমিন
       লিখতে/এডিট/ডিলিট করতে পারবে। */
    match /flashcards/{cardId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    /* ---------- Learning Hub: ডিসকাশন থ্রেড ----------
       যেকোনো লগইন করা ইউজার থ্রেড পড়তে/তৈরি করতে পারবে (নিজের uid দিয়েই),
       শুধু replyCount/lastActivityAt বাড়ানোর জন্য আপডেট করা যাবে (রিপ্লাই দেওয়ার সময়),
       বাকি ফিল্ড বদলানো যাবে না। ডিলিট শুধু অ্যাডমিন করতে পারবে (মডারেশন)। */
    match /discussions/{threadId} {
      allow read: if isSignedIn();

      allow create: if isSignedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.title is string && request.resource.data.title.size() > 0
        && request.resource.data.body is string && request.resource.data.body.size() > 0;

      allow update: if isSignedIn()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["replyCount", "lastActivityAt"]);

      allow delete: if isAdmin();

      match /replies/{replyId} {
        allow read: if isSignedIn();
        allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
        allow delete: if isAdmin();
      }
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
সাইডবারে সেকশনগুলো:
- **ওভারভিউ** — মোট কোর্স, লেসন, পরীক্ষা, ইউজার ও সাম্প্রতিক ফলাফলের পরিসংখ্যান
- **অ্যানালিটিক্স** — মোট রেভিনিউ, এই মাসের রেভিনিউ, গড় অর্ডার ভ্যালু, কোন কোর্স সবচেয়ে বেশি বিক্রি হচ্ছে, গত ৬ মাসের মাসিক রেভিনিউ ও নতুন সাইনআপের ট্রেন্ড — সবকিছু `purchaseRequests`/`users` থেকে সরাসরি হিসাব করা, তাই কোনো পেইড প্ল্যান বা Cloud Function ছাড়াই সম্পূর্ণ ফ্রি
- **হোমপেজ ও ভিডিও** — হিরো সেকশনের লেখা এবং হোমপেজের "স্মার্ট ফিচার্ড ভিডিও" সেকশনে কোন লেসনগুলো দেখাবে তা বাছাই ও ক্রমানুসারে সাজানো (কিছু না বাছাই করলে সবচেয়ে নতুন ভিডিওগুলো এমনিতেই দেখানো হয়)
- **কোর্স** — কোর্স তৈরি, সম্পাদনা, মুছে ফেলা (তালিকা আকারে, সাথে কভার ছবি, লেসন সংখ্যা, মূল্য)
- **লেসন / ভিডিও** — কোর্স বাছাই করে সেই কোর্সের সব ভিডিও/স্লাইড যোগ, সম্পাদনা বা মুছে ফেলা
- **পরীক্ষা** — পরীক্ষা ও প্রশ্ন তৈরি, বিদ্যমান পরীক্ষা সম্পাদনা বা মুছে ফেলা, চাইলে কোনো পেইড কোর্সের সাথে লক করে দেওয়া, এবং প্রতিটি পরীক্ষার জন্য আলাদাভাবে **নেগেটিভ মার্কিং** (ভুল উত্তরে কত মার্ক কাটা যাবে) সেট করা
- **লিডারবোর্ড** — প্রতিটি পরীক্ষার জন্য (অথবা সব পরীক্ষা মিলিয়ে সম্মিলিতভাবে) সব ইউজারের ফলাফল একসাথে র‍্যাঙ্ক করে দেখায়, যাতে কাউকে গিফট দেওয়ার সময় সহজে সিদ্ধান্ত নেওয়া যায়
- **নোটিফিকেশন** — শিরোনাম, মেসেজ ও টাইপ (কোর্স আপডেট / নতুন কোর্স / পরীক্ষা / সাধারণ ঘোষণা) দিয়ে নোটিফিকেশন তৈরি করুন। **কাস্টম লিংক (নতুন):** "Custom Link" ফিল্ডে যেকোনো URL বসিয়ে দিলে — কোনো কোর্স পেজ, YouTube ভিডিও, WhatsApp/Telegram গ্রুপ, PDF, ফর্ম, বা সাইটেরই অন্য কোনো পেজ — নোটিফিকেশনে ট্যাপ করলে ঠিক সেখানেই নিয়ে যাবে। `https://...` দিয়ে শুরু হওয়া লিংক অটোমেটিক নতুন ট্যাবে খুলবে (ছাত্র-ছাত্রী অ্যাপ থেকে বের হয়ে যাবে না), আর সাইটের ভেতরের পেজ (যেমন `admin.html`) একই ট্যাবে খুলবে। এই ফিল্ড খালি রাখলে আগের মতোই কাজ করবে — চাইলে এক বা একাধিক কোর্স ট্যাগ করে দিন (তাতে সেই কোর্সগুলোর নাম চিপ হিসেবে দেখা যাবে এবং নোটিফিকেশনে ট্যাপ করলে প্রথম ট্যাগ করা কোর্সে নিয়ে যাবে)। **পিন (নতুন):** জরুরি কোনো নোটিফিকেশন "Pin to top" টিক দিয়ে তালিকার সবার ওপরে আটকে রাখতে পারবেন, নতুন নোটিফিকেশন এলেও এটা ওপরেই থাকবে। "কারা দেখবে" তে **সবাই** অথবা **শুধু ট্যাগ করা কোর্সে এনরোল করা স্টুডেন্ট** বেছে নিন। প্রতিটি নোটিফিকেশন যেকোনো সময় হাইড/আনহাইড বা ডিলিট করা যায়। ছাত্র-ছাত্রীরা টপনাভে বেল আইকনে (আনরিড ব্যাজসহ) এগুলো দেখবে — সম্পূর্ণ ফ্রি, in-app সিস্টেম (কোনো পুশ-নোটিফিকেশন সার্ভিস/সার্ভার লাগে না)। **⚠️ এটা কাজ করার আগে অবশ্যই উপরের ধাপ ২-এ আপডেট করা Firestore রুলস (`notifications` কালেকশনসহ) Firebase Console-এ বসাতে হবে।**
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

## ৯. র‍্যান্ডম প্রশ্ন পুল, ভিডিও রিজিউম ও সার্টিফিকেট — নতুন সংযোজন

**র‍্যান্ডম প্রশ্ন পুল (পরীক্ষা):** অ্যাডমিন প্যানেল → পরীক্ষা → এডিট/তৈরি করার সময় এখন "Random Question Pool" বক্সে **Questions Per Attempt** নামে একটা অপশন আছে। আপনি চাইলে একটা পরীক্ষায় ১০০০+ প্রশ্ন যোগ করতে পারবেন (পুরো প্রশ্ন ব্যাংক), কিন্তু এই সংখ্যাটা দিলে (যেমন ২৫) — প্রতিটা স্টুডেন্ট, প্রতিবার পরীক্ষা দেওয়ার সময়, ওই পুরো ব্যাংক থেকে একদম র‍্যান্ডমভাবে বাছাই করা ২৫টা প্রশ্ন পাবে। খালি রাখলে আগের মতোই সবাইকে সব প্রশ্ন দেখানো হবে। কোনো নতুন Firestore রুলস লাগবে না — এটা `exams` ডকুমেন্টের একটা নতুন ফিল্ড মাত্র, যেটা আগের রুলসেই কভার হয়।

**ভিডিও রিজিউম:** কোনো লেসনের ভিডিও (YouTube বা সরাসরি আপলোড করা mp4/webm) দেখতে দেখতে মাঝপথে বের হয়ে গেলে, পরেরবার সেই লেসনে ফিরলে ঠিক যেখানে ছেড়েছিলেন সেখান থেকেই চালু হবে (একটা ছোট নোটিফিকেশনসহ)। ৯০% এর বেশি দেখা হয়ে গেলে লেসনটা এমনিতেই "সম্পূর্ণ" হিসেবে মার্ক হয়ে যাবে — আলাদা করে বাটনে ক্লিক করার দরকার নেই। Google Drive-এ হোস্ট করা ভিডিওতে এটা কাজ করবে না (Drive এমবেড থেকে প্লেব্যাক পজিশন পড়া/বদলানো সম্ভব না), শুধু YouTube আর সরাসরি ভিডিও ফাইলে কাজ করে। এটাও `users/{uid}` ডকুমেন্টের একটা নতুন ফিল্ড (`videoProgress`), আলাদা রুলস লাগবে না।

**কোর্স কমপ্লিশন সার্টিফিকেট:** কোনো কোর্সের সবগুলো লেসন সম্পূর্ণ হয়ে গেলে (ম্যানুয়ালি বাটনে ক্লিক করে বা ভিডিও শেষ দেখে অটো-কমপ্লিট হয়ে) কোর্স পেজের উপরে এবং প্রোফাইল → "আমার কোর্স" ট্যাবে একটা সোনালী "সার্টিফিকেট ডাউনলোড করুন" বাটন দেখাবে। ক্লিক করলে ছাত্রের নাম, কোর্সের নাম, সম্পূর্ণ হওয়ার তারিখ ও একটা ইউনিক সার্টিফিকেট আইডিসহ ব্র্যান্ডেড PDF ডাউনলোড হবে (লোগো ওয়াটারমার্ক ও বাংলা ফন্টসহ, বাকি সব PDF-এর মতোই)।


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

## ৮. Learning Hub (ব্যাজ, ডিসকাশন, ফ্ল্যাশকার্ড) — নতুন সংযোজন
নেভবারে নতুন **Hub** ট্যাব (`#/hub`) যোগ হয়েছে — যতক্ষণ না কেউ একবার সেখানে ক্লিক করে দেখছে ততক্ষণ পাশে লাল-বেগুনি **"New"** পিল দেখাবে (ব্রাউজারের `localStorage`-এ মনে রাখে, তাই একবার দেখলে আর দেখাবে না)। এই একই `newPillHtml()`/`markFeatureSeen()` সিস্টেম (`js/utils.js`-এ) ভবিষ্যতের যেকোনো নতুন ফিচারেও পুনরায় ব্যবহার করা যাবে।

- **`js/hub.js`** — Hub পেজের ৩টি ট্যাব (Achievements / Discussion / Flashcards) সাজায়, প্রতিটা ট্যাবেও আলাদা "New" পিল থাকে যতক্ষণ না সেটায় ক্লিক করা হয়
- **`js/badges.js`** — ১৩টি অ্যাচিভমেন্ট ব্যাজ (প্রথম লেসন, কোর্স সম্পূর্ণ, এক্সাম স্কোর, স্ট্রিক, ইত্যাদি) — বিদ্যমান progress/results ডেটা থেকেই client-side এ হিসাব হয়, কোনো Cloud Function লাগে না। দৈনিক লগইন স্ট্রিকও এখানেই ট্র্যাক হয়
- **`js/discussion.js`** — কোর্স-ট্যাগড ডিসকাশন থ্রেড + রিপ্লাই সিস্টেম (`discussions` কালেকশন)
- **`js/flashcards.js`** — স্পেসড-রিপিটিশন ফ্ল্যাশকার্ড রিভিউ (সরলীকৃত SM-2 অ্যালগরিদম), প্রতি ইউজারের রিভিউ শিডিউল `users/{uid}/flashcardProgress`-এ সেভ হয়
- **`js/admin-hub.js`** — অ্যাডমিন প্যানেলে নতুন "Flashcards" (কার্ড তৈরি/এডিট/ডিলিট) ও "Discussion" (থ্রেড মডারেশন) সেকশন
- **`css/hub.css`** — উপরের সবগুলোর স্টাইল + "New" পিল অ্যানিমেশন

> ⚠️ **জরুরি:** এই ফিচারগুলো কাজ করার আগে উপরের ধাপ ২-এর Firestore রুলসের **সম্পূর্ণ, হালনাগাদ ভার্সনটা** আবার Firebase Console → Firestore → Rules-এ পেস্ট করে Publish করতে হবে (নতুন `flashcards`, `discussions`, `discussions/{id}/replies`, ও `users/{uid}/flashcardProgress` রুলস যোগ হয়েছে) — নাহলে Hub পেজে Permission Denied এরর আসবে।

