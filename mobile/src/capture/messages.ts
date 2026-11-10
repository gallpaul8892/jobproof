/** Every sentence the capture screens show, in one place (the tickets quote these exactly). */
export const CAPTURE_MSG = {
  reportFull: "This report has the maximum 60 photos.",
  itemFull: "This item has the maximum 12 photos.",
  storageLow: "Phone storage is low.",
  storageFull: "Not enough space to save photos. Free up space on your phone.",
  locked: "This report has been submitted, so photos can't be added.",
  saveFailed: "Couldn't save that photo. Try again.",
  deleteTitle: "Delete this photo?",
  deleteMessage: "Delete this photo? This can't be undone.",
  notAvailable: "This photo isn't available.",
  cameraNeeded: "JobProof needs the camera to take photos of the work. Photos stay on this phone until they are sent to the office.",
  cameraDenied: "The camera is turned off for JobProof. Turn it on in your phone's settings, or choose photos from the gallery instead.",
  cameraUnavailable: "The camera isn't available on this phone. Choose photos from the gallery instead.",
  recovered: "Recovered after the app closed. Check the stage.",
} as const;

export const photosAdded = (n: number): string => `${n} ${n === 1 ? "photo" : "photos"} added`;
export const filesSkipped = (n: number): string => `${n} ${n === 1 ? "file" : "files"} couldn't be added`;
export const photoCount = (n: number): string => `${n} ${n === 1 ? "photo" : "photos"}`;
