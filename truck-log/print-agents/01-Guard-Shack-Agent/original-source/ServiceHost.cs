// TruckLogPrintAgent V4R6. Built by the Windows .NET Framework C# compiler.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;
using System.ServiceProcess;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public sealed class TruckLogService : ServiceBase {
    private const string NameId = "TruckLogPrintAgent";
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Dana-TruckLog-PrintAgent-V4R6-machine");
    private Process worker;
    private IntPtr job = IntPtr.Zero;
    private volatile bool stopping;
    private string runId;
    public TruckLogService() { ServiceName=NameId; CanStop=true; CanShutdown=true; AutoLog=false; }
    private static string Json(object o) { return new JavaScriptSerializer().Serialize(o); }
    private static string LimitedInput() {
        StringBuilder s = new StringBuilder(); char[] b = new char[4096]; int n;
        while ((n=Console.In.Read(b,0,b.Length))>0) { s.Append(b,0,n); if(s.Length>2*1024*1024) throw new Exception("Input too large"); }
        return s.ToString();
    }
    private static object[] Printers() {
        List<object> list=new List<object>();
        using(var q=new ManagementObjectSearcher("SELECT Name,Local,Network,WorkOffline,PortName,PrinterStatus FROM Win32_Printer"))
        using(var rows=q.Get()) foreach(ManagementObject p in rows) {
            using(p) list.Add(new {name=Convert.ToString(p["Name"]), local=Convert.ToBoolean(p["Local"]), network=Convert.ToBoolean(p["Network"]), offline=Convert.ToBoolean(p["WorkOffline"]), port=Convert.ToString(p["PortName"]), status=Convert.ToInt32(p["PrinterStatus"])});
        }
        return list.ToArray();
    }

    public sealed class GateTarget { public string gate { get; set; } public string printer { get; set; } }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PRINTER_DEFAULTS { public string pDatatype; public IntPtr pDevMode; public uint DesiredAccess; }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr handle,ref PRINTER_DEFAULTS defaults);
    [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
    private static object ProbeGates(string input) {
        GateTarget[] targets=new JavaScriptSerializer().Deserialize<GateTarget[]>(input);
        if(targets==null || targets.Length!=2) throw new Exception("Two gates required");
        List<object> result=new List<object>();HashSet<string> seen=new HashSet<string>();
        foreach(GateTarget t in targets) {
            if(t==null || (t.gate!="EAST"&&t.gate!="WEST") || !seen.Add(t.gate) || String.IsNullOrWhiteSpace(t.printer) || t.printer.Length>255) throw new Exception("Invalid gate");
            foreach(char ch in t.printer) if(Char.IsControl(ch)) throw new Exception("Invalid printer");
            PRINTER_DEFAULTS defaults=new PRINTER_DEFAULTS(); defaults.DesiredAccess=0x00000008; // PRINTER_ACCESS_USE, not administrative access.
            IntPtr handle=IntPtr.Zero; bool ok=OpenPrinter(t.printer,out handle,ref defaults);int code=ok?0:Marshal.GetLastWin32Error();
            if(handle!=IntPtr.Zero)ClosePrinter(handle);
            result.Add(new {gate=t.gate,printer=t.printer,accessible=ok,win32Error=code});
        }
        return new {sid=WindowsIdentity.GetCurrent().User.Value,machine=Environment.MachineName,gates=result.ToArray()};
    }

    private static object Info() {
        using(var q=new ManagementObjectSearcher("SELECT Name,State,StartMode,StartName,PathName,ProcessId FROM Win32_Service WHERE Name='TruckLogPrintAgent'"))
        using(var rows=q.Get()) foreach(ManagementObject s in rows) using(s) {
            using(var k=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\TruckLogPrintAgent"))
            return new {name=Convert.ToString(s["Name"]),state=Convert.ToString(s["State"]),startMode=Convert.ToString(s["StartMode"]),account=Convert.ToString(s["StartName"]),path=Convert.ToString(s["PathName"]),pid=Convert.ToInt32(s["ProcessId"]),delayed=Convert.ToInt32(k==null?0:k.GetValue("DelayedAutoStart",0))};
        }
        return null;
    }
    public static int Main(string[] args) {
        try {
            if(args.Length==0) { ServiceBase.Run(new TruckLogService()); return 0; }
            // Explicit UTF-8 pipe writers also work in Session 0 without any console.
            Console.SetIn(new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false)));
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)) { AutoFlush=true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(),new UTF8Encoding(false)) { AutoFlush=true });
            if(args.Length!=1) throw new Exception("One operation required");
            switch(args[0]) {
                case "--admin": return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)?0:1;
                case "--identity": Console.Write(Json(new {sid=WindowsIdentity.GetCurrent().User.Value,name=WindowsIdentity.GetCurrent().Name,machine=Environment.MachineName})); return 0;
                case "--printers": Console.Write(Json(Printers())); return 0;
                case "--probe": Console.Write(Json(ProbeGates(LimitedInput()))); return 0;
                case "--info": Console.Write(Json(Info())); return 0;
                case "--seal": {
                    byte[] plain=Encoding.UTF8.GetBytes(LimitedInput());
                    try { Console.Write(Convert.ToBase64String(ProtectedData.Protect(plain,Entropy,DataProtectionScope.LocalMachine))); }
                    finally { Array.Clear(plain,0,plain.Length); }
                    return 0;
                }
                case "--unseal": {
                    byte[] plain=ProtectedData.Unprotect(Convert.FromBase64String(LimitedInput().Trim()),Entropy,DataProtectionScope.LocalMachine);
                    try { Console.Write(Encoding.UTF8.GetString(plain)); }
                    finally { Array.Clear(plain,0,plain.Length); }
                    return 0;
                }
                case "--selftest": {
                    byte[] a=Encoding.UTF8.GetBytes("TruckLog-V4R6-selftest");
                    byte[] b=ProtectedData.Unprotect(ProtectedData.Protect(a,Entropy,DataProtectionScope.LocalMachine),Entropy,DataProtectionScope.LocalMachine);
                    if(Encoding.UTF8.GetString(a)!=Encoding.UTF8.GetString(b)) throw new Exception("DPAPI self-test failed");
                    Console.Write("PASS machine DPAPI round-trip / compiled service host"); return 0;
                }
                default: throw new Exception("Unknown operation");
            }
        } catch { Console.Error.WriteLine("Windows native helper failed. No credential content has been logged."); return 1; }
    }
    protected override void OnStart(string[] args) {
        stopping=false; runId=Guid.NewGuid().ToString();
        // Child waits for matching launch.json; no API or printer action before job assignment.
        string launch=Path.Combine(Root,"data","launch.json");
        if(File.Exists(launch)) File.Delete(launch);
        job=CreateJobObject(IntPtr.Zero,null);
        if(job==IntPtr.Zero) throw new Exception("Cannot create child process job");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits=new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags=0x2000; // KILL_ON_JOB_CLOSE
        int size=Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr p=Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits,p,false);
            if(!SetInformationJobObject(job,9,p,(uint)size)) { CloseHandle(job);job=IntPtr.Zero;throw new Exception("Cannot configure process job"); }
        } finally { Marshal.FreeHGlobal(p); }
        worker=new Process(); worker.StartInfo=new ProcessStartInfo();
        worker.StartInfo.FileName=Path.Combine(Root,"node.exe");
        worker.StartInfo.Arguments="--use-system-ca \""+Path.Combine(Root,"agent.cjs")+"\" --service "+runId;
        worker.StartInfo.WorkingDirectory=Root;
        worker.StartInfo.UseShellExecute=false; worker.StartInfo.CreateNoWindow=true;
        worker.StartInfo.EnvironmentVariables.Remove("NODE_OPTIONS");
        worker.StartInfo.EnvironmentVariables.Remove("NODE_PATH");
        worker.StartInfo.EnvironmentVariables.Remove("NODE_TLS_REJECT_UNAUTHORIZED");
        worker.EnableRaisingEvents=true;
        worker.Exited += delegate { if(!stopping) Environment.Exit(1); };
        try {
            if(!worker.Start()) throw new Exception("Worker start failed");
            if(!AssignProcessToJobObject(job,worker.Handle)) { worker.Kill(); throw new Exception("Cannot contain worker process"); }
            File.WriteAllText(launch,Json(new {runId=runId,workerPid=worker.Id,servicePid=Process.GetCurrentProcess().Id}),new UTF8Encoding(false));
        } catch { if(job!=IntPtr.Zero) {CloseHandle(job);job=IntPtr.Zero;} throw; }
    }
    protected override void OnStop() { StopWorker(); }
    protected override void OnShutdown() { StopWorker(); }
    private void StopWorker() {
        stopping=true;
        try {
            RequestAdditionalTime(70000);
            File.WriteAllText(Path.Combine(Root,"data","stop.request"),runId,new UTF8Encoding(false));
            if(worker!=null && !worker.HasExited) worker.WaitForExit(60000);
        } catch { }
        finally {
            if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; }
            if(worker!=null) { worker.Dispose();worker=null; }
        }
    }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit,PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass,SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr lpJobAttributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int infoClass,IntPtr info,uint cb);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
}
