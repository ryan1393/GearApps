namespace LapperReadLibrary.Models;


    public record LastLog
    (
        string id,
        string machine_cycle_id,
        string macro_id,
        decimal value
    );
