namespace LapperReadLibrary.Models;

public record Equipment(
    string id,
    string? number,
    string ip,
    string? dept_id,
    string? description,
    string? type,
    string? builder,
    string? cell,
    string status,
    ScannerDetail? scanner);
