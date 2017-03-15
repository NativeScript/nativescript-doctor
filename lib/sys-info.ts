import { ChildProcess } from "./wrappers/child-process";
import { FileSystem } from "./wrappers/file-system";
import { HostInfo } from "./host-info";
import { ExecOptions } from "child_process";
import { WinReg } from "./winreg";
import { Helpers } from "./helpers";
import { platform } from "os";
import * as path from "path";
import * as osenv from "osenv";
import * as temp from "temp";
import * as semver from "semver";

export class SysInfo implements NativeScriptDoctor.ISysInfo {
	// Different java has different format for `java -version` command.
	private static JAVA_VERSION_REGEXP = /(?:openjdk|java) version \"((?:\d+\.)+(?:\d+))/i;

	private static JAVA_COMPILER_VERSION_REGEXP = /^javac (.*)/im;
	private static XCODE_VERSION_REGEXP = /Xcode (.*)/;
	private static VERSION_REGEXP = /(\d{1,})\.(\d{1,})\.*([\w-]{0,})/m;
	private static GIT_VERSION_REGEXP = /^git version (.*)/;
	private static GRADLE_VERSION_REGEXP = /Gradle (.*)/i;

	private monoVerRegExp = /version (\d+[.]\d+[.]\d+) /gm;

	private javaVerCache: string;
	private javaCompilerVerCache: string;
	private xCodeVerCache: string;
	private npmVerCache: string;
	private nodeGypVerCache: string;
	private xCodeprojGemLocationCache: string;
	private iTunesInstalledCache: boolean = null;
	private cocoaPodsVerCache: string;
	private osCache: string;
	private adbVerCache: string;
	private androidInstalledCache: boolean = null;
	private monoVerCache: string;
	private gitVerCache: string;
	private gradleVerCache: string;
	private sysInfoCache: NativeScriptDoctor.ISysInfoData;
	private isCocoaPodsWorkingCorrectlyCache: boolean = null;
	private nativeScriptCliVersionCache: string;
	private xcprojInfoCache: NativeScriptDoctor.IXcprojInfo;
	private isCocoaPodsUpdateRequiredCache: boolean = null;
	private shouldCache: boolean = true;

	constructor(private childProcess: ChildProcess,
		private fileSystem: FileSystem,
		private helpers: Helpers,
		private hostInfo: HostInfo,
		private winReg: WinReg) { }

	public getJavaVersion(): Promise<string> {
		return this.getValueForProperty(() => this.javaVerCache, async (): Promise<string> => {
			try {
				const spawnResult = await this.childProcess.spawnFromEvent("java", ["-version"], "exit");
				const matches = spawnResult && SysInfo.JAVA_VERSION_REGEXP.exec(spawnResult.stderr);
				return matches && matches[1];
			} catch (err) {
				return null;
			}
		});
	}

	public getJavaCompilerVersion(): Promise<string> {
		return this.getValueForProperty(() => this.javaCompilerVerCache, async (): Promise<string> => {
			const javaCompileExecutableName = "javac";
			const javaHome = process.env.JAVA_HOME;
			const pathToJavaCompilerExecutable = javaHome ? path.join(javaHome, "bin", javaCompileExecutableName) : javaCompileExecutableName;
			try {
				const output = await this.childProcess.exec(`"${pathToJavaCompilerExecutable}" -version`);
				return SysInfo.JAVA_COMPILER_VERSION_REGEXP.exec(output.stderr)[1];
			} catch (err) {
				return null;
			}
		});
	}

	public getXcodeVersion(): Promise<string> {
		return this.getValueForProperty(() => this.xCodeVerCache, async (): Promise<string> => {
			if (this.hostInfo.isDarwin) {
				const output = await this.execCommand("xcodebuild -version");
				const xcodeVersionMatch = output && output.match(SysInfo.XCODE_VERSION_REGEXP);

				if (xcodeVersionMatch) {
					return this.getVersionFromString(output);
				}
			}
		});
	}

	public async getNodeVersion(): Promise<string> {
		return this.getVersionFromString(process.version);
	}

	public getNpmVersion(): Promise<string> {
		return this.getValueForProperty(() => this.npmVerCache, async (): Promise<string> => {
			const output = await this.execCommand("npm -v");
			return output ? output.split("\n")[0] : null;
		});
	}

	public getNodeGypVersion(): Promise<string> {
		return this.getValueForProperty(() => this.nodeGypVerCache, async (): Promise<string> => {
			const output = await this.execCommand("node-gyp -v");
			return output ? this.getVersionFromString(output) : null;
		});
	}

	public getXcodeprojGemLocation(): Promise<string> {
		return this.getValueForProperty(() => this.xCodeprojGemLocationCache, async (): Promise<string> => {
			const output = await this.execCommand("gem which xcodeproj");
			return output ? output.trim() : null;
		});
	}

	public isITunesInstalled(): Promise<boolean> {
		return this.getValueForProperty(() => this.iTunesInstalledCache, async (): Promise<boolean> => {
			if (this.hostInfo.isLinux) {
				return false;
			}

			let coreFoundationDir: string;
			let mobileDeviceDir: string;

			if (this.hostInfo.isWindows) {
				const commonProgramFiles = this.hostInfo.isWindows64 ? process.env["CommonProgramFiles(x86)"] : process.env.CommonProgramFiles;
				coreFoundationDir = path.join(commonProgramFiles, "Apple", "Apple Application Support");
				mobileDeviceDir = path.join(commonProgramFiles, "Apple", "Mobile Device Support");
			} else if (this.hostInfo.isDarwin) {
				coreFoundationDir = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
				mobileDeviceDir = "/System/Library/PrivateFrameworks/MobileDevice.framework/MobileDevice";
			}

			return await this.fileSystem.exists(coreFoundationDir) && await this.fileSystem.exists(mobileDeviceDir);
		});
	}

	public getCocoaPodsVersion(): Promise<string> {
		return this.getValueForProperty(() => this.cocoaPodsVerCache, async (): Promise<string> => {
			if (this.hostInfo.isDarwin) {
				if (this.hostInfo.isDarwin) {
					const output = await this.execCommand("pod --version");
					// Output of pod --version could contain some warnings. Find the version in it.
					const cocoaPodsVersionMatch = output && output.match(SysInfo.VERSION_REGEXP);
					if (cocoaPodsVersionMatch && cocoaPodsVersionMatch[0]) {
						return cocoaPodsVersionMatch[0].trim();
					}
				}
			}
		});
	}

	public getOs(): Promise<string> {
		return this.getValueForProperty(() => this.osCache, async (): Promise<string> => {
			return await (this.hostInfo.isWindows ? this.winVer() : this.unixVer());
		});
	}

	public getAdbVersion(): Promise<string> {
		return this.getValueForProperty(() => this.adbVerCache, async (): Promise<string> => {
			const output = await this.execCommand("adb version");
			return output ? this.getVersionFromString(output) : null;
		});
	}

	// `android -h` returns exit code 1 on successful invocation (Mac OS X for now, possibly Linux).
	public isAndroidInstalled(): Promise<boolean> {
		return this.getValueForProperty(() => this.androidInstalledCache, async (): Promise<boolean> => {
			let pathToAndroid = "android";
			if (this.hostInfo.isWindows) {
				pathToAndroid = `${pathToAndroid}.bat`;
			}

			try {
				// On mac android -h returns exit code 1. That's why we need to ignore the error.
				const output = await this.childProcess.spawnFromEvent(pathToAndroid, ["-h"], "close", { ignoreError: true });
				if (output) {
					output.stdout = output.stdout || '';
					return output.stdout.indexOf("android") >= 0;
				}
			} catch (err) {
				return null;
			}
		});
	}

	public getMonoVersion(): Promise<string> {
		return this.getValueForProperty(() => this.monoVerCache, async (): Promise<string> => {
			const output = await this.execCommand("mono --version");
			const match = this.monoVerRegExp.exec(output);
			return match ? match[1] : null;
		});
	}

	public getGitVersion(): Promise<string> {
		return this.getValueForProperty(() => this.gitVerCache, async (): Promise<string> => {
			const output = await this.execCommand("git --version");
			const matches = SysInfo.GIT_VERSION_REGEXP.exec(output);
			return matches && matches[1];

		});
	}

	public getGradleVersion(): Promise<string> {
		return this.getValueForProperty(() => this.gradleVerCache, async (): Promise<string> => {
			const output = await this.execCommand("gradle -v");
			const matches = SysInfo.GRADLE_VERSION_REGEXP.exec(output);

			return matches && matches[1];
		});
	}

	public getSysInfo(): Promise<NativeScriptDoctor.ISysInfoData> {
		return this.getValueForProperty(() => this.sysInfoCache, async (): Promise<NativeScriptDoctor.ISysInfoData> => {
			const result: NativeScriptDoctor.ISysInfoData = Object.create(null);

			// os stuff
			result.platform = platform();
			result.shell = osenv.shell();
			result.os = await this.getOs();

			// node stuff
			result.procArch = process.arch;
			result.nodeVer = await this.getNodeVersion();
			result.npmVer = await this.getNpmVersion();
			result.nodeGypVer = await this.getNodeGypVersion();

			result.dotNetVer = await this.hostInfo.dotNetVersion();
			result.javaVer = await this.getJavaVersion();
			result.javacVersion = await this.getJavaCompilerVersion();
			result.xcodeVer = await this.getXcodeVersion();
			result.xcodeprojGemLocation = await this.getXcodeprojGemLocation();
			result.itunesInstalled = await this.isITunesInstalled();
			result.cocoaPodsVer = await this.getCocoaPodsVersion();
			result.adbVer = await this.getAdbVersion();
			result.androidInstalled = await this.isAndroidInstalled();
			result.monoVer = await this.getMonoVersion();
			result.gitVer = await this.getGitVersion();
			result.gradleVer = await this.getGradleVersion();
			result.isCocoaPodsWorkingCorrectly = await this.isCocoaPodsWorkingCorrectly();
			result.nativeScriptCliVersion = await this.getNativeScriptCliVersion();
			result.isCocoaPodsUpdateRequired = await this.isCocoaPodsUpdateRequired();

			return result;
		});
	}

	public isCocoaPodsWorkingCorrectly(): Promise<boolean> {
		return this.getValueForProperty(() => this.isCocoaPodsWorkingCorrectlyCache, async (): Promise<boolean> => {
			if (this.hostInfo.isDarwin) {
				temp.track();
				const tempDirectory = temp.mkdirSync("nativescript-check-cocoapods");
				const pathToXCodeProjectZip = path.join(__dirname, "..", "resources", "cocoapods-verification", "cocoapods.zip");

				await this.fileSystem.extractZip(pathToXCodeProjectZip, tempDirectory);

				const xcodeProjectDir = path.join(tempDirectory, "cocoapods");

				try {
					let spawnResult = await this.childProcess.spawnFromEvent("pod", ["install"], "exit", { spawnOptions: { cwd: xcodeProjectDir } });
					if (spawnResult.exitCode) {
						return false;
					} else {
						return await this.fileSystem.exists(path.join(xcodeProjectDir, "cocoapods.xcworkspace"));
					}
				} catch (err) {
					return null;
				}
			} else {
				return false;
			}
		});
	}

	public getNativeScriptCliVersion(): Promise<string> {
		return this.getValueForProperty(() => this.nativeScriptCliVersionCache, async (): Promise<string> => {
			const output = await this.execCommand("tns --version");
			return output ? output.trim() : output;
		});
	}

	public getXcprojInfo(): Promise<NativeScriptDoctor.IXcprojInfo> {
		return this.getValueForProperty(() => this.xcprojInfoCache, async (): Promise<NativeScriptDoctor.IXcprojInfo> => {
			const cocoaPodsVersion = await this.getCocoaPodsVersion();
			const xcodeVersion = await this.getXcodeVersion();

			// CocoaPods with version lower than 1.0.0 don't support Xcode 7.3 yet
			// https://github.com/CocoaPods/CocoaPods/issues/2530#issuecomment-210470123
			// as a result of this all .pbxprojects touched by CocoaPods get converted to XML plist format
			const shouldUseXcproj = cocoaPodsVersion && !!(semver.lt(cocoaPodsVersion, "1.0.0") && semver.gte(xcodeVersion, "7.3.0"));
			let xcprojAvailable: boolean;

			if (shouldUseXcproj) {
				// If that's the case we can use xcproj gem to convert them back to ASCII plist format
				xcprojAvailable = !!(await this.exec("xcproj --version"));
			}

			return { shouldUseXcproj, xcprojAvailable };
		});
	}

	public isCocoaPodsUpdateRequired(): Promise<boolean> {
		return this.getValueForProperty(() => this.isCocoaPodsUpdateRequiredCache, async (): Promise<boolean> => {
			let xcprojInfo = await this.getXcprojInfo();
			if (xcprojInfo.shouldUseXcproj && !xcprojInfo.xcprojAvailable) {
				return true;
			} else {
				return false;
			}
		});
	}

	public setShouldCacheSysInfo(shouldCache: boolean): void {
		this.shouldCache = shouldCache;
	}

	private async getValueForProperty<T>(property: Function, getValueMethod: () => Promise<T>): Promise<T> {
		if (this.shouldCache) {
			const propertyName = this.helpers.getPropertyName(property);
			const cachedValue: T = (<any>this)[propertyName];

			if (cachedValue === undefined || cachedValue === null) {
				const result = await getValueMethod();
				(<any>this)[propertyName] = result;
				return result;
			} else {
				return cachedValue;
			}
		} else {
			return await getValueMethod();
		}
	}

	private async exec(cmd: string, execOptions?: ExecOptions): Promise<IProcessInfo> {
		if (cmd) {
			try {
				return await this.childProcess.exec(cmd, execOptions);
			} catch (err) {
				return null;
			}
		}

		return null;
	}

	private async execCommand(cmd: string, execOptions?: ExecOptions): Promise<string> {
		const output = await this.exec(cmd, execOptions);
		return output && output.stdout;
	}

	private getVersionFromString(versionString: string): string {
		const matches = versionString.match(SysInfo.VERSION_REGEXP);
		if (matches) {
			return `${matches[1]}.${matches[2]}.${matches[3] || 0}`;
		}

		return null;
	}

	private async winVer(): Promise<string> {
		let productName: string;
		let currentVersion: string;
		let currentBuild: string;
		const hive = this.winReg.registryKeys.HKLM;
		const key = "\\Software\\Microsoft\\Windows NT\\CurrentVersion";

		productName = await this.winReg.getRegistryValue("ProductName", hive, key);
		currentVersion = await this.winReg.getRegistryValue("CurrentVersion", hive, key);
		currentBuild = await this.winReg.getRegistryValue("CurrentBuild", hive, key);

		return `${productName} ${currentVersion}.${currentBuild}`;
	}

	private unixVer(): Promise<string> {
		return this.execCommand("uname -a");
	}
}
