export default process.env.PROJECT_ID !== 'records-classificater' ? {
  apiKey: "AIzaSyCdEu_wJyhSKJZgIDSZOZPP3NIor-wZrSQ",
  authDomain: location.hostname,
  projectId: "records-classificater-test",
  storageBucket: "records-classificater-test.appspot.com",
  messagingSenderId: "621218742775",
  appId: "1:621218742775:web:7b9443d921b7acd58aeef2",
} : {
  apiKey: "AIzaSyA67VdxczWRf5omaZzEBpL0ARAVD8rKQmk",
  authDomain: "records-classificater.web.app",
  projectId: "records-classificater",
  storageBucket: "records-classificater.appspot.com",
  messagingSenderId: "454521647958",
  appId: "1:454521647958:web:c22b7a14ce850d09051cf7",
  measurementId: "G-78752ECQRN"
};
