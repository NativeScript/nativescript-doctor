import { Constants } from "./constants";
import { SysInfo } from "./sys-info";
import { EOL } from "os";
import { HostInfo } from "./host-info";
import { AndroidLocalBuildRequirements } from "./local-build-requirements/android-local-build-requirements";
import { IosLocalBuildRequirements } from "./local-build-requirements/ios-local-build-requirements";
import { Helpers } from "./helpers";
import * as semver from "semver";

export class Doctor {
	private static MIN_SUPPORTED_POD_VERSION = "0.38.2";

	constructor(private sysInfo: SysInfo,
		private hostInfo: HostInfo,
		private androidLocalBuildRequirements: AndroidLocalBuildRequirements,
		private iosLocalBuildRequirements: IosLocalBuildRequirements,
		private helpers: Helpers) { }

	public async canExecuteLocalBuild(platform: string): Promise<boolean> {
		this.validatePlatform(platform);

		if (platform.toLocaleLowerCase() === Constants.ANDROID_PLATFORM_NAME.toLocaleLowerCase()) {
			return await this.androidLocalBuildRequirements.checkRequirements();
		} else if (platform.toLocaleLowerCase() === Constants.IOS_PLATFORM_NAME.toLocaleLowerCase()) {
			return await this.iosLocalBuildRequirements.checkRequirements();
		}

		return false;
	}

	public async getWarnings(): Promise<IWarning[]> {
		const result: IWarning[] = [];
		const sysInfoData = await this.sysInfo.getSysInfo();

		if (!sysInfoData.adbVer) {
			result.push({
				warning: "WARNING: adb from the Android SDK is not installed or is not configured properly. ",
				additionalInformation: "For Android-related operations, the AppBuilder CLI will use a built-in version of adb." + EOL
				+ "To avoid possible issues with the native Android emulator, Genymotion or connected" + EOL
				+ "Android devices, verify that you have installed the latest Android SDK and" + EOL
				+ "its dependencies as described in http://developer.android.com/sdk/index.html#Requirements" + EOL
			});
		}

		if (!sysInfoData.androidInstalled) {
			result.push({
				warning: "WARNING: The Android SDK is not installed or is not configured properly.",
				additionalInformation: "You will not be able to run your apps in the native emulator. To be able to run apps" + EOL
				+ "in the native Android emulator, verify that you have installed the latest Android SDK " + EOL
				+ "and its dependencies as described in http://developer.android.com/sdk/index.html#Requirements" + EOL
			});
		}

		if (this.hostInfo.isDarwin) {
			if (!sysInfoData.xcodeVer) {
				result.push({
					warning: "WARNING: Xcode is not installed or is not configured properly.",
					additionalInformation: "You will not be able to build your projects for iOS or run them in the iOS Simulator." + EOL
					+ "To be able to build for iOS and run apps in the native emulator, verify that you have installed Xcode." + EOL
				});
			}

			if (!sysInfoData.xcodeprojGemLocation) {
				result.push({
					warning: "WARNING: xcodeproj gem is not installed or is not configured properly.",
					additionalInformation: "You will not be able to build your projects for iOS." + EOL
					+ "To be able to build for iOS and run apps in the native emulator, verify that you have installed xcodeproj." + EOL
				});
			}

			if (!sysInfoData.cocoapodVer) {
				result.push({
					warning: "WARNING: CocoaPods is not installed or is not configured properly.",
					additionalInformation: "You will not be able to build your projects for iOS if they contain plugin with CocoaPod file." + EOL
					+ "To be able to build such projects, verify that you have installed CocoaPods."
				});
			}

			if (sysInfoData.xcodeVer && sysInfoData.cocoapodVer) {
				let isCocoaPodsWorkingCorrectly = await this.sysInfo.isCocoaPodsWorkingCorrectly();
				if (!isCocoaPodsWorkingCorrectly) {
					result.push({
						warning: "WARNING: There was a problem with CocoaPods",
						additionalInformation: "Verify that CocoaPods are configured properly."
					});
				}
			}

			if (sysInfoData.cocoapodVer && semver.valid(sysInfoData.cocoapodVer) && semver.lt(sysInfoData.cocoapodVer, Doctor.MIN_SUPPORTED_POD_VERSION)) {
				result.push({
					warning: `WARNING: Your current CocoaPods version is earlier than ${Doctor.MIN_SUPPORTED_POD_VERSION}.`,
					additionalInformation: "You will not be able to build your projects for iOS if they contain plugin with CocoaPod file." + EOL
					+ `To be able to build such projects, verify that you have at least ${Doctor.MIN_SUPPORTED_POD_VERSION} version installed.`
				});
			}

			if (!sysInfoData.monoVer || semver.lt(sysInfoData.monoVer, "3.12.0")) {
				result.push({
					warning: "WARNING: Mono 3.12 or later is not installed or not configured properly.",
					additionalInformation: "You will not be able to work with Android devices in the device simulator or debug on connected Android devices." + EOL
					+ "To be able to work with Android in the device simulator and debug on connected Android devices," + EOL
					+ "download and install Mono 3.12 or later from http://www.mono-project.com/download/" + EOL
				});
			}
		} else {
			result.push({
				warning: "NOTE: You can develop for iOS only on Mac OS X systems.",
				additionalInformation: "To be able to work with iOS devices and projects, you need Mac OS X Mavericks or later." + EOL
			});
		}

		if (!sysInfoData.itunesInstalled) {
			result.push({
				warning: "WARNING: iTunes is not installed.",
				additionalInformation: "You will not be able to work with iOS devices via cable connection." + EOL
				+ "To be able to work with connected iOS devices," + EOL
				+ "download and install iTunes from http://www.apple.com" + EOL
			});
		}

		if (!sysInfoData.javaVer) {
			result.push({
				warning: "WARNING: The Java Development Kit (JDK) is not installed or is not configured properly.",
				additionalInformation: "You will not be able to work with the Android SDK and you might not be able" + EOL
				+ "to perform some Android-related operations. To ensure that you can develop and" + EOL
				+ "test your apps for Android, verify that you have installed the JDK as" + EOL
				+ "described in http://docs.oracle.com/javase/8/docs/technotes/guides/install/install_overview.html (for JDK 8)" + EOL
				+ "or http://docs.oracle.com/javase/7/docs/webnotes/install/ (for JDK 7)." + EOL
			});
		}

		if (!sysInfoData.gitVer) {
			result.push({
				warning: "WARNING: Git is not installed or not configured properly.",
				additionalInformation: "You will not be able to create and work with Screen Builder projects." + EOL
				+ "To be able to work with Screen Builder projects, download and install Git as described" + EOL
				+ "in https://git-scm.com/downloads and add the git executable to your PATH." + EOL
			});
		}

		return result;
	}

	private isPlatformSupported(platform: string): boolean {
		return Constants.SUPPORTED_PLATFORMS.reduce((prevValue, currentValue) => {
			if (!prevValue) {
				return currentValue.toLocaleLowerCase() === platform.toLocaleLowerCase();
			} else {
				return prevValue;
			}
		}, false);
	}

	private validatePlatform(platform: string): void {
		if (!platform) {
			throw new Error("You must specify a platform.");
		}

		if (!this.isPlatformSupported(platform)) {
			throw new Error(`Platform ${platform} is not supported. The supported platforms are: ${Constants.SUPPORTED_PLATFORMS.join(", ")}`);
		}
	}
}