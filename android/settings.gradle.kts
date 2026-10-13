pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "cloud-dupe-cleaner"
include(":core")

val sdkDir = System.getenv("ANDROID_HOME")
    ?: System.getenv("ANDROID_SDK_ROOT")
    ?: run {
        val local = file("local.properties")
        if (!local.exists()) return@run null
        local.readLines().firstOrNull { it.startsWith("sdk.dir=") }?.substringAfter("=")
    }

if (!sdkDir.isNullOrBlank() && file(sdkDir).isDirectory) {
    include(":app")
}
