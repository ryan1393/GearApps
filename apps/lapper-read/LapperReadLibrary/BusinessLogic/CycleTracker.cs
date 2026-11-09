using LapperReadLibrary.Models;

namespace LapperReadLibrary.BusinessLogic;

/// <summary>Tracks transitions without network calls or replacing an active serial.</summary>
public sealed class CycleTracker(CycleState state)
{
    public CycleState State { get; } = state;

    public void Observe(MachineState machine, ScannerState scanner, string machineId,
        Func<Dictionary<string, decimal>> captureMacros, DateTimeOffset timestamp)
    {
        var queuedSerial = scanner.Queue;
        if (machine.InCycle && State.WasInCycle != true && State.ActiveCycle == null)
        {
            // Starting halfway through a cycle cannot establish which part was loaded.
            var serial = State.WasInCycle == false && machine.DoorClosed && machine.StartCycle
                ? queuedSerial : null;
            if (string.IsNullOrWhiteSpace(serial)) serial = null;
            State.ActiveCycle = new PendingCycle
            {
                Serial = serial, MachineId = machineId, PartNumber = machine.Ident,
                Consec = machine.Consec, StartedAt = timestamp
            };
            if (!string.IsNullOrWhiteSpace(serial)) queuedSerial = null;
        }
        if (!machine.InCycle && !machine.DoorClosed && State.ActiveCycle is { } active)
        {
            if (!string.IsNullOrWhiteSpace(active.Serial))
            {
                active.Macros = captureMacros();
                active.CompletedAt = timestamp;
                State.PendingCycles.Add(active);
            }
            State.ActiveCycle = null;
        }
        State.ScannerSerial = scanner.Serial;
        State.QueuedSerial = queuedSerial;
        State.WasInCycle = machine.InCycle;
    }
}
