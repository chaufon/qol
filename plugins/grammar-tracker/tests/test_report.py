from lib.db import connect, save_check
from lib.report import top_report
from lib.transcript import Check, Mistake


def save(conn, turn, created_at, *mistakes):
    save_check(
        conn,
        turn_id=turn,
        session_id="s",
        created_at=created_at,
        project_dir="/p",
        original="original",
        check=Check(
            input_mode="typed",
            corrected_prompt="corrected",
            mistakes=[Mistake(type=t, identifier=i, original="o", corrected="c") for t, i in mistakes],
        ),
    )


def report(conn):
    return top_report(conn, limit=10, since="2026-11-08T00:00:00.000Z", threshold=3)


def test_focus_lists_the_main_type_the_rising_mistake_and_the_fading_one_in_that_order(tmp_path):
    conn = connect(tmp_path / "g.db")
    for n in range(3):
        save(conn, f"old{n}", f"2026-11-01T12:00:0{n}.000Z", ("article", "the"), ("article", "a/an"))
    save(conn, "new1", "2026-11-10T12:00:00.000Z", ("spelling", "necessity"))
    save(conn, "new2", "2026-11-11T12:00:00.000Z", ("spelling", "necessity"))
    focus = report(conn)["focus"]
    assert [f["kind"] for f in focus] == ["type", "rising", "fading"]
    assert (focus[0]["type"], focus[0]["rows"], focus[0]["count"]) == ("article", 2, 6)
    assert (focus[1]["identifier"], focus[1]["recent"], focus[1]["above_usual"]) == ("necessity", 2, 2)
    assert (focus[2]["type_label"], focus[2]["identifier"]) == ("article", "a/an")
    assert focus[0]["type_description"] == 'A wrong, missing or extra "a/an" or "the".'


def test_focus_leaves_out_a_type_with_one_row_and_what_has_no_case(tmp_path):
    conn = connect(tmp_path / "g.db")
    save(conn, "p1", "2026-11-01T12:00:00.000Z", ("article", "the"), ("spelling", "necessity"))
    assert report(conn)["focus"] == []


def test_each_top_mistake_carries_its_occurrences_in_the_last_days(tmp_path):
    conn = connect(tmp_path / "g.db")
    save(conn, "p1", "2026-11-01T12:00:00.000Z", ("article", "the"))
    save(conn, "p2", "2026-11-10T12:00:00.000Z", ("article", "the"))
    [the] = report(conn)["mistakes"]
    assert (the["count"], the["recent"], the["is_recurring"]) == (2, 1, False)
