import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

fun cdcSetting(name: String): String? {
    System.getenv(name)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    (findProperty(name) as? String)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    val localFile = rootProject.file("local.properties")
    if (!localFile.isFile) return null
    val props = Properties()
    localFile.inputStream().use { props.load(it) }
    return props.getProperty(name)?.trim()?.takeIf { it.isNotEmpty() }
}

val cdcStoreFile = cdcSetting("CDC_STORE_FILE")
val cdcStorePassword = cdcSetting("CDC_STORE_PASSWORD")
val cdcKeyAlias = cdcSetting("CDC_KEY_ALIAS")
val cdcKeyPassword = cdcSetting("CDC_KEY_PASSWORD")
val hasReleaseKey = cdcStoreFile != null &&
    cdcStorePassword != null &&
    cdcKeyAlias != null &&
    cdcKeyPassword != null

fun publicId(name: String, raw: String?, pattern: Regex): String {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) return ""
    if (!pattern.matches(value)) {
        error("$name is set but does not match the expected public client id shape, so it was not written into the build.")
    }
    return value
}

fun buildConfigString(value: String): String {
    return "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
}

// Same shape as InstalledAppRedirect.google. Empty stays a non-routable placeholder.
fun googleRedirectScheme(clientId: String): String {
    val suffix = ".apps.googleusercontent.com"
    if (!clientId.endsWith(suffix)) return "com.googleusercontent.apps.unconfigured"
    val prefix = clientId.removeSuffix(suffix)
    if (!Regex("^[0-9]+-[a-z0-9]+$").matches(prefix)) return "com.googleusercontent.apps.unconfigured"
    return "com.googleusercontent.apps.$prefix"
}

val googleClientId = publicId(
    "CDC_GOOGLE_CLIENT_ID",
    cdcSetting("CDC_GOOGLE_CLIENT_ID"),
    Regex("^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$"),
)
val dropboxClientId = publicId(
    "CDC_DROPBOX_APP_KEY",
    cdcSetting("CDC_DROPBOX_APP_KEY"),
    Regex("^[a-z0-9]{15}$"),
)
val googleScheme = googleRedirectScheme(googleClientId)
val googleRedirectUri = if (googleClientId.isEmpty()) "" else "$googleScheme:/oauth2redirect"

android {
    namespace = "com.njg.clouddupecleaner"
    compileSdk = 35

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(cdcStoreFile!!)
                storePassword = cdcStorePassword
                keyAlias = cdcKeyAlias
                keyPassword = cdcKeyPassword
            }
        }
    }

    defaultConfig {
        applicationId = "com.njg.clouddupecleaner"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "2.1.0"
        buildConfigField("String", "DROPBOX_CLIENT_ID", buildConfigString(dropboxClientId))
        buildConfigField("String", "ONEDRIVE_CLIENT_ID", "\"\"")
        buildConfigField("String", "GOOGLE_CLIENT_ID", buildConfigString(googleClientId))
        buildConfigField("String", "DROPBOX_REDIRECT_URI", "\"clouddupecleaner://oauth\"")
        buildConfigField("String", "GOOGLE_REDIRECT_URI", buildConfigString(googleRedirectUri))
        manifestPlaceholders["googleRedirectScheme"] = googleScheme
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

configurations.configureEach {
    exclude(group = "org.json", module = "json")
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
