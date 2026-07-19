const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// @yks-reanimated-worklets-release-lint-workaround';
const WORKAROUND = `${MARKER}
// Reanimated/Worklets .gradle.kts scripts can crash this AGP version's Kotlin UAST
// analysis. Keep app/library lint enabled and skip only the two crashing third-party
// release analysis tasks until the upstream workaround covers lintAnalyzeRelease.
def affectedLintProjects = [":react-native-reanimated", ":react-native-worklets"] as Set
subprojects { subproject ->
  if (affectedLintProjects.contains(subproject.path)) {
    subproject.tasks.configureEach { task ->
      if (task.name == "lintAnalyzeRelease") {
        task.enabled = false
      }
    }
  }
}
`;

module.exports = function withReanimatedWorkletsReleaseLintWorkaround(config) {
  return withProjectBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error(
        'The Reanimated/Worklets release lint workaround requires a Groovy root build.gradle.',
      );
    }
    if (!modConfig.modResults.contents.includes(MARKER)) {
      modConfig.modResults.contents = `${modConfig.modResults.contents.trimEnd()}\n\n${WORKAROUND}`;
    }
    return modConfig;
  });
};
