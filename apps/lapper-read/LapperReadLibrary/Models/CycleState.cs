namespace LapperReadLibrary.Models;

public record MachineState(int Ident, int Consec, bool DoorClosed, bool StartCycle, bool InCycle);
public record ScannerState(string? Serial, string? Queue);

public class PendingCycle
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string? Serial { get; set; }
    public string MachineId { get; set; } = "";
    public int PartNumber { get; set; }
    public int Consec { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset CompletedAt { get; set; }
    public Dictionary<string, decimal> Macros { get; set; } = new();
    public MachineCycle? SavedCycle { get; set; }
}

public class CycleState
{
    public bool? WasInCycle { get; set; }
    public string? ScannerSerial { get; set; }
    public string? QueuedSerial { get; set; }
    public PendingCycle? ActiveCycle { get; set; }
    public List<PendingCycle> PendingCycles { get; set; } = new();
}
