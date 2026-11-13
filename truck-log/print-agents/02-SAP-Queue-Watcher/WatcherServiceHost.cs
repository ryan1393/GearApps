// TruckLogPackingSlipWatcher service host (Truck Log SAP packing-slip watcher).
// Compiled on the print PC by INSTALL-WATCHER-SERVICE.ps1 with the Windows .NET Framework
// C# compiler (%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe), the same compiler
// and pattern the guard agent (TruckLogPrintAgent) uses. No Python packages are needed for it.
//
// What it does: runs as LocalSystem, starts
//   <InstallDir>\.venv\Scripts\python.exe -I -u <InstallDir>\sap_capture_watcher.py run --service
//       --config <InstallDir>\watcher.ini --stop-file <StateDir>\service-stop.request --run-id <guid>
// inside a Job object (KILL_ON_JOB_CLOSE) that also contains this host, so the Python processes can
// never outlive the service. Stop: writes the run id into service-stop.request; Python stops new
// processing, cancels its renderer if needed and preserves durable captures (60 s host deadline). If Python exits on its own the host exits with code 1 so the
// Service Control Manager restarts it (failure actions set by the installer).
// Its own events go to <StateDir>\service-host.log; the watcher logs to <StateDir>\watcher.log.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.ServiceProcess;
using System.Runtime.InteropServices;

public sealed class TruckLogPackingSlipWatcherService : ServiceBase {
    public const string NameId = "TruckLogPackingSlipWatcher";
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private readonly string stateDir;
    private Process worker;
    private IntPtr job = IntPtr.Zero;
    private volatile bool stopping;
    private string runId;
    private readonly object logLock = new object();

    public TruckLogPackingSlipWatcherService(string stateDir) {
        ServiceName = NameId; CanStop = true; CanShutdown = true; AutoLog = false;
        this.stateDir = stateDir;
    }

    private string StopFile { get { return Path.Combine(stateDir, "service-stop.request"); } }

    private void Log(string message) {
        try {
            lock (logLock) {
                Directory.CreateDirectory(stateDir);
                string path = Path.Combine(stateDir, "service-host.log");
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 5 * 1024 * 1024) File.Copy(path, path + ".1", true);
                if (fi.Exists && fi.Length > 5 * 1024 * 1024) File.Delete(path);
                File.AppendAllText(path, DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ") + " [HOST] " + message + "\r\n",
                                   new UTF8Encoding(false));
            }
        } catch { }
    }

    private static string Quote(string value) {
        if (value.IndexOf('"') >= 0 || value.EndsWith("\\")) throw new Exception("Unsupported path: " + value);
        return "\"" + value + "\"";
    }

    public static int Main(string[] args) {
        // Service: TruckLogPackingSlipWatcher.exe --service "<state dir>"
        if (args.Length == 2 && args[0] == "--service") {
            string dir = args[1].Trim().TrimEnd('\\');
            if (dir.Length < 4 || !Path.IsPathRooted(dir) || dir.IndexOf('"') >= 0) return 2;
            ServiceBase.Run(new TruckLogPackingSlipWatcherService(dir));
            return 0;
        }
        if (args.Length == 1 && args[0] == "--version") {
            Console.WriteLine(NameId + " host; root " + Root);
            return 0;
        }
        Console.Error.WriteLine("This program is the Windows service host. Use INSTALL-WATCHER-SERVICE.cmd, "
                                + "STATUS-WATCHER-SERVICE.cmd or START-WATCHER.cmd (foreground debug run).");
        return 2;
    }

    protected override void OnStart(string[] args) {
        stopping = false; runId = Guid.NewGuid().ToString();
        string python = Path.Combine(Root, ".venv\\Scripts\\python.exe");
        string script = Path.Combine(Root, "sap_capture_watcher.py");
        string config = Path.Combine(Root, "watcher.ini");
        try {
            Directory.CreateDirectory(stateDir);
            if (File.Exists(StopFile)) File.Delete(StopFile);
            if (!File.Exists(python)) throw new Exception("Missing " + python + " (re-run INSTALL-WATCHER-SERVICE.cmd)");
            if (!File.Exists(script)) throw new Exception("Missing " + script);
            if (!File.Exists(config)) throw new Exception("Missing " + config);
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Exception("Cannot create child process job");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr p = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, p, false);
                if (!SetInformationJobObject(job, 9, p, (uint)size)) throw new Exception("Cannot configure process job");
            } finally { Marshal.FreeHGlobal(p); }
            // The venv python.exe is a launcher that immediately starts the real interpreter. Put THIS
            // process in the job first so every child inherits it with no race; the job handle is closed
            // only when this host process exits, which then terminates anything left in the job.
            bool hostInJob = AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle);
            if (!hostInJob) Log("warning: could not place the host in the job (error " + Marshal.GetLastWin32Error() + "); assigning the worker after start");
            worker = new Process();
            worker.StartInfo = new ProcessStartInfo();
            worker.StartInfo.FileName = python;
            worker.StartInfo.Arguments = "-I -u " + Quote(script) + " run --service --config " + Quote(config)
                + " --stop-file " + Quote(StopFile) + " --run-id " + runId;
            worker.StartInfo.WorkingDirectory = Root;
            worker.StartInfo.UseShellExecute = false; worker.StartInfo.CreateNoWindow = true;
            worker.StartInfo.EnvironmentVariables.Remove("PYTHONPATH");
            worker.StartInfo.EnvironmentVariables.Remove("PYTHONHOME");
            worker.StartInfo.EnvironmentVariables.Remove("PYTHONSTARTUP");
            worker.StartInfo.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            worker.EnableRaisingEvents = true;
            worker.Exited += delegate {
                if (stopping) return;
                int code = -1; try { code = worker.ExitCode; } catch { }
                Log("watcher process exited unexpectedly (exit " + code + "); exiting so Windows restarts the service. "
                    + "See watcher.log and watcher-service-console.log.");
                Environment.Exit(1);
            };
            if (!worker.Start()) throw new Exception("Worker start failed");
            if (!hostInJob && !AssignProcessToJobObject(job, worker.Handle)) { try { worker.Kill(); } catch { } throw new Exception("Cannot contain worker process"); }
            Log("started run " + runId + " worker pid " + worker.Id + " (" + python + ")");
        } catch (Exception e) {
            Log("start failed: " + e.Message);
            throw; // the service stops; closing the job at process exit removes any child
        }
    }

    protected override void OnStop() { StopWorker("stop"); }
    protected override void OnShutdown() { StopWorker("shutdown"); }

    private void StopWorker(string why) {
        stopping = true;
        try {
            RequestAdditionalTime(70000);
            File.WriteAllText(StopFile, runId, new UTF8Encoding(false));
            if (worker != null && !worker.HasExited && !worker.WaitForExit(60000)) {
                Log(why + ": watcher did not finish within 60 s; terminating it");
                try { worker.Kill(); } catch { }
            } else Log(why + ": watcher finished");
        } catch (Exception e) { Log(why + ": " + e.Message); }
        finally {
            // Anything still in the job is terminated when this process exits (KILL_ON_JOB_CLOSE).
            if (worker != null) { worker.Dispose(); worker = null; }
            try { if (File.Exists(StopFile)) File.Delete(StopFile); } catch { }
        }
    }

    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint cb);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
}
