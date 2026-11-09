using LapperReadLibrary.Models;

namespace LapperReadLibrary.BusinessLogic.Interfaces;

public interface IScanners : IDisposable
{
    Task<ScannerState> ReadAsync(ScannerState previous, CancellationToken cancellationToken = default);
    Task<string> Input2Async(string command, CancellationToken cancellationToken = default);
}
