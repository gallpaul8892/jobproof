// react-native-web ships Flow types only; this is the part of its Linking the demo shim uses.
declare module "react-native-web/dist/exports/Linking" {
  interface LinkingApi {
    openURL(url: string, target?: string): Promise<void>;
    canOpenURL(url: string): Promise<boolean>;
    openSettings(): Promise<void>;
  }
  const Linking: LinkingApi;
  export default Linking;
}
