import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// IMPORTANT: Replace with your app's Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyDA1l26WqPcOOD5jJw-x6t3EC3DEsDwa1g",
  authDomain: "checklistst.firebaseapp.com",
  projectId: "checklistst",
  storageBucket: "checklistst.firebasestorage.app",
  messagingSenderId: "103073954743",
  appId: "1:103073954743:web:9f5d86eadde0f3c7e48632"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export API key for Identity Toolkit REST calls
export const firebaseApiKey = firebaseConfig.apiKey;

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Firestore and get a reference to the service
export const db = getFirestore(app);
