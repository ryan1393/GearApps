namespace LapperReadLibrary.Models;

public record MachineCycle(
    string id,
    Equipment machine,
    Gearset gearset,
    int consec,
    string timestamp);
