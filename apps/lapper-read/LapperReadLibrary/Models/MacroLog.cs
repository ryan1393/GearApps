namespace LapperReadLibrary.Models;

public record MacroLog(
    string id,
    MachineCycle machine_cycle,
    string machine_cycle_id,
    Macro macro,
    string macro_id,
    decimal value);
