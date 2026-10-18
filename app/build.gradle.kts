plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.soulfork.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.soulfork.tv"
        minSdk = 22
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "1.0.0"
    }

    signingConfigs {
        // Same key locally and in CI (restored from the KEYSTORE_B64 secret) so the Fire Stick
        // accepts updates over the installed app. The .jks itself is gitignored.
        create("shared") {
            storeFile = rootProject.file("keystore/soulforktv.jks")
            storePassword = "soulforktv"
            keyAlias = "soulforktv"
            keyPassword = "soulforktv"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        debug { signingConfig = signingConfigs.getByName("shared") }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("io.coil-kt:coil:2.7.0")
    testImplementation("junit:junit:4.13.2")
}
