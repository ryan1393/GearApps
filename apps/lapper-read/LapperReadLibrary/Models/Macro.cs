namespace LapperReadLibrary.Models;

public record Macro(
    string id,
    short number,
    string name,
    int status,
    string type,
    int? tab_index,
    string used_form,
    string l60_table,
    string extra);
