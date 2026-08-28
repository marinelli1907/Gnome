const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "Gnome Xcode 26 fmt compatibility";

module.exports = function withFmtXcode26Fix(config) {
  return withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, "Podfile");
      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (podfile.includes(MARKER)) return modConfig;

      const anchor = [
        "    react_native_post_install(",
        "      installer,",
        "      config[:reactNativePath],",
        "      :mac_catalyst_enabled => false,",
        "      :ccache_enabled => ccache_enabled?(podfile_properties),",
        "    )",
      ].join("\n");

      const patch = [
        anchor,
        "",
        `    # ${MARKER}: fmt 11.0.2 misdetects consteval support in Apple Clang 21.`,
        "    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')",
        "    if File.exist?(fmt_base)",
        "      fmt_source = File.read(fmt_base)",
        "      fmt_patched = fmt_source.sub(",
        "        '#elif defined(__apple_build_version__) && __apple_build_version__ < 14000029L',",
        "        '#elif defined(__apple_build_version__) && (__apple_build_version__ < 14000029L || __apple_build_version__ >= 21000000L)'",
        "      )",
        "      if fmt_patched != fmt_source",
        "        File.chmod(0644, fmt_base)",
        "        File.write(fmt_base, fmt_patched)",
        "      end",
        "    end",
      ].join("\n");

      if (!podfile.includes(anchor)) {
        throw new Error("Could not install the Xcode 26 fmt compatibility hook in Podfile");
      }

      podfile = podfile.replace(anchor, patch);
      fs.writeFileSync(podfilePath, podfile);
      return modConfig;
    },
  ]);
};
