declare module 'js-yaml' {
    interface YamlApi {
        load(input: string): unknown;
    }

    const yaml: YamlApi;
    export default yaml;
}
