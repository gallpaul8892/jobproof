import Linking from "react-native-web/dist/exports/Linking";

/**
 * react-native-web's Linking, except for the links that only a phone can follow. The job screen's
 * address (`geo:`) and phone number (`tel:`) hand over to the maps and dialler apps; a desktop
 * browser has neither, so these reject, and the app shows its own "couldn't open" message under
 * the link instead of a blank tab. (Replaces react-native-web/dist/exports/Linking.)
 */
const PHONE_ONLY = /^(geo|tel|sms|mailto):/i;
const refusal = () => new Error("This link opens a phone app, which a browser demo does not have.");

const DemoLinking = Object.create(Linking) as typeof Linking;
DemoLinking.openURL = async (url: string, target?: string) => {
  if (PHONE_ONLY.test(url)) throw refusal();
  return Linking.openURL(url, target);
};
DemoLinking.canOpenURL = async (url: string) => !PHONE_ONLY.test(url) && Linking.canOpenURL(url);
DemoLinking.openSettings = async () => {
  throw refusal();
};

export default DemoLinking;
