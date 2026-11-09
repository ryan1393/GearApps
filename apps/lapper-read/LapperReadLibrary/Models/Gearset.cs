namespace LapperReadLibrary.Models;

public record Gearset(
    string id,
    string number,
    string? rev,
    string summary_id,
    string? pinion_id,
    string? ring_id,
    string status,
    string? user_id);
