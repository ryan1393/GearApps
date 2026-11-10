namespace LapperReadLibrary.Models;

public class LapperConfiguration
{
    public string MachineIp { get; set; } = "";
    public string? MachineNumber { get; set; }
    public string ScannerIp { get; set; } = "";
    public int ScannerInput1Port { get; set; } = 9004;
    public int ScannerInput2Port { get; set; } = 9013;
    public int PollIntervalMilliseconds { get; set; } = 250;
    public int RetryDelayMilliseconds { get; set; } = 5000;
    public int IoTimeoutMilliseconds { get; set; } = 3000;
    public string StateDirectory { get; set; } = "state";
}
