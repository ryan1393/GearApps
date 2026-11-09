using LapperReadLibrary.Models;

namespace LapperReadLibrary.BusinessLogic.Interfaces;

public interface IDatabaseCalls
{
    Task<Auth?> Login(CancellationToken cancellationToken = default);
    Task<bool> CheckToken(CancellationToken cancellationToken = default);
    Task<Equipment?> GetMachineByIp(string ip, CancellationToken cancellationToken = default, string? machineNumber = null);
    Task<ScannerDetail?> GetScannerByIp(string ip, CancellationToken cancellationToken = default);
    Task<ScannerDetail?> GetScannerById(string id, CancellationToken cancellationToken = default);
    Task<Gearset?> GetGearsetByNumber(int partNumber, CancellationToken cancellationToken = default);
    Task<Gearset?> PostGearset(int partNumber, CancellationToken cancellationToken = default);
    Task<MachineFanucVariable?> GetMachineFanucVariableByMachineId(Equipment machine, CancellationToken cancellationToken = default);
    Task<MachineFanucVariable?> PatchMachineFanucVariables(bool doorClosed, bool startCycle, bool inCycle, MachineFanucVariable variable, CancellationToken cancellationToken = default);
    Task<ScannerDetail?> PutScannerDetailsSerialNumbers(string? process, string? queue, string? scannerSerial, ScannerDetail scanner, CancellationToken cancellationToken = default);
    Task<MachineCycle?> PostMachineCycle(string? serialNumber, int consec, string machineId, string gearsetId, DateTimeOffset? timestamp = null, string? requestId = null, CancellationToken cancellationToken = default);
    Task<MacroLog?> PostMacroLog(MachineCycle cycle, string macroId, decimal value, string? requestId = null, CancellationToken cancellationToken = default);
    Task<Macro[]?> GetMacroList(CancellationToken cancellationToken = default);
    Task<MacroLog[]?> GetLappingSummary(LastLogData data, CancellationToken cancellationToken = default);
}
