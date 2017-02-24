import { ChildProcess } from "./wrappers/child-process";
import { FileSystem } from "./wrappers/file-system";
import { SysInfo } from "./sys-info";
import { HostInfo } from "./host-info";
import { WinReg } from "./winreg";
import { Helpers } from "./helpers";
import { Doctor } from "./doctor";
import { AndroidLocalBuildRequirements } from "./local-build-requirements/android-local-build-requirements";
import { IosLocalBuildRequirements } from "./local-build-requirements/ios-local-build-requirements";
import { Constants as constants } from "./constants";

const childProcess = new ChildProcess();
const winReg = new WinReg();
const hostInfo = new HostInfo(winReg);
const fileSystem = new FileSystem();
const helpers = new Helpers();

const sysInfo: NativeScriptDoctor.ISysInfo = new SysInfo(childProcess, fileSystem, helpers, hostInfo, winReg);

const androidLocalBuildRequirements = new AndroidLocalBuildRequirements(sysInfo);
const iOSLocalBuildRequirements = new IosLocalBuildRequirements(sysInfo, hostInfo);

const doctor: NativeScriptDoctor.IDoctor = new Doctor(androidLocalBuildRequirements, helpers, hostInfo, iOSLocalBuildRequirements, sysInfo);

const setShouldCacheSysInfo = sysInfo.setShouldCacheSysInfo.bind(sysInfo);

export {
	sysInfo,
	doctor,
	constants,
	setShouldCacheSysInfo
};
