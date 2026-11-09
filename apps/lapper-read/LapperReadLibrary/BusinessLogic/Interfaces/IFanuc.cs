using LapperReadLibrary.Models;

namespace LapperReadLibrary.BusinessLogic.Interfaces;

public interface IFanuc : IDisposable
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
    MachineState ReadState();
    string? GetMacroValue(short number);
    Dictionary<string, decimal> CaptureMacros();
    Task PersistMacrosAsync(MachineCycle cycle, IReadOnlyDictionary<string, decimal> values, string requestId, CancellationToken cancellationToken = default);
}
